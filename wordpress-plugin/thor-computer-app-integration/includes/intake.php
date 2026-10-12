<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Forwards Contact Form 7 quote submissions to the Thor Computer platform.
 *
 * Safety properties:
 *  - Server-to-server only: the HMAC secret never reaches the browser.
 *  - Requires an explicit consent checkbox ("thor-consent") on the form.
 *  - Idempotent: a stable submission id is sent so retries never create duplicate requests.
 *  - Rate limited per IP + email; failures never break the visitor's normal CF7 submission.
 *  - The enquiry stays "awaiting customer" until the visitor confirms by email and signs in.
 */
add_action( 'wpcf7_mail_sent', 'thor_app_forward_enquiry', 20 );

function thor_app_forward_enquiry( $contact_form ) {
	$o = thor_app_opts();
	if ( empty( $o['intake_on'] ) || (string) $contact_form->id() !== (string) $o['cf7_form_id'] ) { return; }
	if ( '' === thor_app_secret() || '' === thor_app_endpoint() ) { thor_app_log( 'not_configured' ); return; }

	$sub = WPCF7_Submission::get_instance();
	if ( ! $sub ) { return; }
	$d = $sub->get_posted_data();

	// Consent is mandatory. Without it nothing leaves WordPress.
	$consent = isset( $d['thor-consent'] ) ? $d['thor-consent'] : array();
	if ( empty( $consent ) || ( is_array( $consent ) && '' === implode( '', $consent ) ) ) { thor_app_log( 'no_consent' ); return; }

	$email = isset( $d['email'] ) ? sanitize_email( $d['email'] ) : '';
	if ( ! is_email( $email ) ) { thor_app_log( 'bad_email' ); return; }

	// Local rate limit (per IP and per email) before we call the API.
	$ip  = $sub->get_meta( 'remote_ip' );
	$key = 'thor_rl_' . md5( $ip . '|' . strtolower( $email ) );
	$n   = (int) get_transient( $key );
	if ( $n >= 3 ) { thor_app_log( 'rate_limited' ); return; }
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );

	// Stable per submission: CF7's posted-data hash + site, so a retry is a duplicate not a new request.
	$submission_id = hash( 'sha256', home_url() . '|' . $contact_form->id() . '|' . $sub->get_meta( 'timestamp' ) . '|' . $ip . '|' . strtolower( $email ) );
	thor_app_log( thor_app_send_enquiry( thor_app_fields_from( $d, $email ), $submission_id ) );
}

/** Sanitised, length-capped fields in the shape wpIntake expects. Shared by Contact Form 7 and the native [thor_repair_form]. */
function thor_app_fields_from( $d, $email ) {
	$f = function ( $k, $max ) use ( $d ) { return isset( $d[ $k ] ) ? mb_substr( sanitize_text_field( is_array( $d[ $k ] ) ? implode( ' ', $d[ $k ] ) : $d[ $k ] ), 0, $max ) : ''; };
	$fields = array(
		'first_name' => $f( 'first_name', 80 ), 'email' => $email, 'phone' => $f( 'phone', 30 ), 'postal_code' => $f( 'postal_code', 10 ),
		'brand' => $f( 'brand', 60 ), 'model' => $f( 'model', 80 ), 'serial_n' => $f( 'serial_n', 60 ), 'problem' => $f( 'problem', 2000 ),
	);
	foreach ( array( 'device_type' => 20, 'service_method' => 20, 'urgency' => 10 ) as $k => $max ) { if ( '' !== $f( $k, $max ) ) { $fields[ $k ] = $f( $k, $max ); } }
	return $fields;
}

/** Signed server-to-server POST to the platform. Returns a short result code for the status screen; never throws. */
function thor_app_send_enquiry( $fields, $submission_id ) {
	$body = wp_json_encode( array( 'submissionId' => $submission_id, 'consent' => true, 'fields' => $fields ) );
	$ts   = time();
	$sig  = hash_hmac( 'sha256', $ts . '.' . $body, thor_app_secret() );

	$res = wp_remote_post( thor_app_endpoint(), array(
		'timeout' => 8, 'redirection' => 0, 'blocking' => true,
		'headers' => array( 'Content-Type' => 'application/json', 'X-Thor-Timestamp' => (string) $ts, 'X-Thor-Signature' => $sig ),
		'body'    => $body,
	) );
	if ( is_wp_error( $res ) ) { return 'error: ' . $res->get_error_code(); } // graceful: the visitor's normal email already went out
	return 'http_' . wp_remote_retrieve_response_code( $res );
}

/** Native repair request form ([thor_repair_form]): same consent, rate limit, signing and central intake as Contact Form 7. */
add_action( 'admin_post_nopriv_thor_repair_request', 'thor_app_handle_form' );
add_action( 'admin_post_thor_repair_request', 'thor_app_handle_form' );
function thor_app_handle_form() {
	$back = wp_get_referer() ? wp_get_referer() : home_url( '/' );
	$go = function ( $r ) use ( $back ) { wp_safe_redirect( add_query_arg( 'thor_request', $r, $back ) . '#thor-repair-form' ); exit; };
	if ( ! isset( $_POST['thor_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['thor_nonce'] ) ), 'thor_repair_request' ) ) { $go( 'expired' ); }
	if ( ! empty( $_POST['thor_website'] ) ) { $go( 'sent' ); }                                   // honeypot: pretend success to bots
	if ( '' === thor_app_secret() || '' === thor_app_endpoint() ) { thor_app_log( 'not_configured' ); $go( 'error' ); }
	if ( empty( $_POST['thor_consent'] ) ) { $go( 'consent' ); }
	$d = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised field by field in thor_app_fields_from()
	$email = isset( $d['email'] ) ? sanitize_email( $d['email'] ) : '';
	if ( ! is_email( $email ) || mb_strlen( trim( (string) ( $d['problem'] ?? '' ) ) ) < 5 ) { $go( 'invalid' ); }
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'thor_rl_' . md5( $ip . '|' . strtolower( $email ) );
	$n   = (int) get_transient( $key );
	if ( $n >= 3 ) { thor_app_log( 'rate_limited' ); $go( 'busy' ); }
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );
	$submission_id = hash( 'sha256', home_url() . '|form|' . sanitize_text_field( $d['thor_nonce'] ) . '|' . $ip . '|' . strtolower( $email ) );
	$result = thor_app_send_enquiry( thor_app_fields_from( $d, $email ), $submission_id );
	thor_app_log( $result );
	$go( 'http_200' === $result ? 'sent' : 'error' );
}

function thor_app_log( $result ) {
	update_option( 'thor_app_last_intake', array( 'time' => time(), 'result' => $result ), false );
}
