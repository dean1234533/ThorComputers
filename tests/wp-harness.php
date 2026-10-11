<?php
// Loads the REAL plugin files (settings.php + intake.php) against minimal WordPress/Contact Form 7 stubs and runs intake scenarios.
// It performs genuine HTTP POSTs (PHP curl) to the URL given in $argv[1], so the PHP-signed HMAC is verified by the real wpIntake function.
// Invoked by tests/wp-plugin.mjs; prints one JSON object per scenario. Not WordPress itself: shortcodes/admin screens are only linted.
define( 'ABSPATH', __DIR__ . '/' ); define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['hooks'] = []; $GLOBALS['options'] = []; $GLOBALS['transients'] = []; $GLOBALS['sent'] = [];
function add_action( $h, $cb, $p = 10 ) { $GLOBALS['hooks'][ $h ][] = $cb; } function add_filter( $h, $cb ) { add_action( $h, $cb ); }
function add_options_page() {} function register_setting() {} function plugin_basename( $f ) { return basename( $f ); } function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function wp_parse_args( $a, $d ) { return array_merge( $d, (array) $a ); }
function get_option( $k, $d = false ) { return $GLOBALS['options'][ $k ] ?? $d; } function update_option( $k, $v, $a = null ) { $GLOBALS['options'][ $k ] = $v; return true; }
function get_transient( $k ) { return $GLOBALS['transients'][ $k ] ?? false; } function set_transient( $k, $v, $t ) { $GLOBALS['transients'][ $k ] = $v; return true; }
function sanitize_email( $e ) { return filter_var( trim( $e ), FILTER_SANITIZE_EMAIL ); } function is_email( $e ) { return (bool) filter_var( $e, FILTER_VALIDATE_EMAIL ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_UNICODE ); }
function home_url() { return 'https://thorcomputer.test'; } function is_wp_error( $r ) { return $r instanceof WP_Error; }
class WP_Error { public $c; function __construct( $c ) { $this->c = $c; } function get_error_code() { return $this->c; } }
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_post( $url, $args ) {
	$ch = curl_init( $url ); $h = []; foreach ( $args['headers'] as $k => $v ) { $h[] = "$k: $v"; }
	curl_setopt_array( $ch, [ CURLOPT_POST => true, CURLOPT_POSTFIELDS => $args['body'], CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $args['timeout'], CURLOPT_CONNECTTIMEOUT => 3 ] );
	$body = curl_exec( $ch ); $code = curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ); $err = curl_errno( $ch ); curl_close( $ch );
	$GLOBALS['sent'][] = $args['body'];
	return $err ? new WP_Error( 'http_request_failed' ) : [ 'code' => $code, 'body' => $body ];
}
class WPCF7_Submission {
	static $inst; public $data; public $meta;
	static function get_instance() { return self::$inst; } function get_posted_data() { return $this->data; } function get_meta( $k ) { return $this->meta[ $k ] ?? ''; }
}
class FakeForm { public $i; function __construct( $id ) { $this->i = $id; } function id() { return $this->i; } }

$url = $argv[1]; $secret = $argv[2];
define( 'THOR_APP_API_SECRET', $secret ); define( 'THOR_APP_INTAKE_URL', $url );
define( 'THOR_APP_DIR', __DIR__ . '/../wordpress-plugin/thor-computer-app-integration/' );
require THOR_APP_DIR . 'includes/settings.php'; require THOR_APP_DIR . 'includes/intake.php';

function run( $label, $data, $opts = [], $meta = [] ) {
	$GLOBALS['options']['thor_app_options'] = array_merge( [ 'intake_on' => 1 ], $opts ); unset( $GLOBALS['options']['thor_app_last_intake'] ); $before = count( $GLOBALS['sent'] );
	$s = new WPCF7_Submission(); $s->data = $data; $s->meta = array_merge( [ 'remote_ip' => '203.0.113.9', 'timestamp' => '1700000000' ], $meta ); WPCF7_Submission::$inst = $s;
	foreach ( $GLOBALS['hooks']['wpcf7_mail_sent'] as $cb ) { $cb( new FakeForm( $opts['form'] ?? '2682' ) ); }
	echo json_encode( [ 'label' => $label, 'result' => $GLOBALS['options']['thor_app_last_intake']['result'] ?? null, 'http_calls' => count( $GLOBALS['sent'] ) - $before ] ), "\n";
}
$good = [ 'first_name' => 'Pia', 'email' => $argv[3], 'phone' => '07700900123', 'postal_code' => 'BR1 1AA', 'brand' => 'Acer', 'model' => 'Swift 3', 'serial_n' => 'PHPSERIAL', 'problem' => 'Battery drains in ten minutes', 'thor-consent' => [ 'I agree' ] ];
run( 'valid_with_consent', $good );
run( 'same_submission_retried', $good );                                    // same ip/timestamp/email => same submissionId => server dedupes
run( 'no_consent', array_diff_key( $good, [ 'thor-consent' => 1 ] ) );
run( 'empty_consent_array', array_merge( $good, [ 'thor-consent' => [ '' ] ] ) );
run( 'bad_email', array_merge( $good, [ 'email' => 'not-an-email' ] ) );
run( 'other_form_ignored', $good, [ 'form' => '9999', 'cf7_form_id' => '2682' ] );
run( 'integration_disabled', $good, [ 'intake_on' => 0 ] );
run( 'third_attempt_allowed', $good );                                       // attempt 3 of 3 (scenarios that return early do not count)
run( 'rate_limited_on_4th', $good );
$GLOBALS['transients'] = [];
run( 'html_and_long_input_sanitised', array_merge( $good, [ 'problem' => '<script>alert(1)</script>' . str_repeat( 'x', 5000 ) ] ), [], [ 'timestamp' => '1700000001' ] );
echo json_encode( [ 'label' => 'last_payload_problem_len', 'result' => strlen( json_decode( end( $GLOBALS['sent'] ), true )['fields']['problem'] ), 'http_calls' => 0 ] ), "\n";
$GLOBALS['transients'] = [];
