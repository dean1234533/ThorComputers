<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Central option accessor with safe defaults. */
function thor_app_opts() {
	return wp_parse_args( get_option( 'thor_app_options', array() ), array(
		'app_url'        => 'https://app.thorcomputer.com',
		'button_text'    => 'Get the Thor Computer App',
		'floating_on'    => 0,
		'floating_text'  => 'Get Our App',
		'floating_pos'   => 'right',   // left|right
		'banner_on'      => 0,
		'banner_title'   => 'Need Your Computer Fixed?',
		'banner_text'    => 'Find qualified engineers, compare repair quotes and book appointments directly from your phone.',
		'exclude_pages'  => '',        // comma separated page IDs / slugs
		'cf7_form_id'    => '2682',    // existing quote form (found on /get-quote-computer-repair-within-london-and-kent/)
		'intake_on'      => 0,
		'consent_text'   => 'I agree to Thor Computer sharing my enquiry with approved engineers on the Thor Computer app so I can receive quotes.',
		'quotes_text'    => 'Get Repair Quotes',
		'request_text'   => 'Request a Repair',
		'find_text'      => 'Find an Engineer',
		'track_text'     => 'Track My Repair',
		'login_text'     => 'Customer Login',
		'engineer_text'  => 'Join as an Engineer',
	) );
}

/** The API secret is read from wp-config.php (define('THOR_APP_API_SECRET', '...')) so it never lives in the database, HTML or JS. */
function thor_app_secret() {
	return defined( 'THOR_APP_API_SECRET' ) ? (string) THOR_APP_API_SECRET : '';
}
function thor_app_endpoint() {
	return defined( 'THOR_APP_INTAKE_URL' ) ? (string) THOR_APP_INTAKE_URL : '';
}

add_action( 'admin_menu', function () {
	add_options_page( 'Thor Computer App', 'Thor Computer App', 'manage_options', 'thor-app', 'thor_app_render_settings' );
} );

add_action( 'admin_init', function () {
	register_setting( 'thor_app', 'thor_app_options', array( 'sanitize_callback' => 'thor_app_sanitize' ) );
} );

function thor_app_sanitize( $in ) {
	$o = thor_app_opts();
	$out = array();
	$url = esc_url_raw( isset( $in['app_url'] ) ? trim( $in['app_url'] ) : $o['app_url'] );
	$out['app_url']       = ( 0 === strpos( $url, 'https://' ) ) ? untrailingslashit( $url ) : $o['app_url']; // HTTPS only
	foreach ( array( 'button_text', 'floating_text', 'banner_title', 'consent_text', 'quotes_text', 'request_text', 'find_text', 'track_text', 'login_text', 'engineer_text' ) as $k ) { $out[ $k ] = sanitize_text_field( isset( $in[ $k ] ) ? $in[ $k ] : $o[ $k ] ); }
	$out['banner_text']   = sanitize_textarea_field( isset( $in['banner_text'] ) ? $in['banner_text'] : $o['banner_text'] );
	$out['floating_pos']  = ( isset( $in['floating_pos'] ) && 'left' === $in['floating_pos'] ) ? 'left' : 'right';
	$out['floating_on']   = empty( $in['floating_on'] ) ? 0 : 1;
	$out['banner_on']     = empty( $in['banner_on'] ) ? 0 : 1;
	$out['intake_on']     = empty( $in['intake_on'] ) ? 0 : 1;
	$out['exclude_pages'] = sanitize_text_field( isset( $in['exclude_pages'] ) ? $in['exclude_pages'] : '' );
	$out['cf7_form_id']   = preg_replace( '/[^0-9]/', '', isset( $in['cf7_form_id'] ) ? $in['cf7_form_id'] : $o['cf7_form_id'] );
	return $out;
}

function thor_app_render_settings() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
	$o = thor_app_opts();
	$secret_ok = '' !== thor_app_secret();
	$endpoint_ok = '' !== thor_app_endpoint();
	$cf7_ok = defined( 'WPCF7_VERSION' );
	$last = get_option( 'thor_app_last_intake', array() );
	?>
	<div class="wrap">
		<h1>Thor Computer App Integration</h1>
		<h2>Integration status</h2>
		<table class="widefat striped" style="max-width:720px"><tbody>
			<tr><td>Contact Form 7 installed</td><td><?php echo $cf7_ok ? '&#10003; Yes' : '&#10007; No'; ?></td></tr>
			<tr><td>API secret defined in wp-config.php</td><td><?php echo $secret_ok ? '&#10003; Yes' : '&#10007; Missing (add <code>THOR_APP_API_SECRET</code>)'; ?></td></tr>
			<tr><td>Intake URL defined in wp-config.php</td><td><?php echo $endpoint_ok ? '&#10003; Yes' : '&#10007; Missing (add <code>THOR_APP_INTAKE_URL</code>)'; ?></td></tr>
			<tr><td>Last enquiry forwarded</td><td><?php echo ! empty( $last['time'] ) ? esc_html( wp_date( 'j M Y H:i', $last['time'] ) . ' (' . $last['result'] . ')' ) : 'None yet'; ?></td></tr>
		</tbody></table>
		<form method="post" action="options.php">
			<?php settings_fields( 'thor_app' ); ?>
			<table class="form-table" role="presentation">
				<tr><th><label for="app_url">Application URL</label></th><td><input id="app_url" class="regular-text" name="thor_app_options[app_url]" value="<?php echo esc_attr( $o['app_url'] ); ?>"><p class="description">Must start with https://</p></td></tr>
				<tr><th><label for="button_text">Button text</label></th><td><input id="button_text" class="regular-text" name="thor_app_options[button_text]" value="<?php echo esc_attr( $o['button_text'] ); ?>"></td></tr>
				<tr><th>Floating button</th><td><label><input type="checkbox" name="thor_app_options[floating_on]" value="1" <?php checked( $o['floating_on'] ); ?>> Show on pages</label><br>
					<input name="thor_app_options[floating_text]" value="<?php echo esc_attr( $o['floating_text'] ); ?>"> &nbsp;
					<select name="thor_app_options[floating_pos]"><option value="right" <?php selected( $o['floating_pos'], 'right' ); ?>>Bottom right</option><option value="left" <?php selected( $o['floating_pos'], 'left' ); ?>>Bottom left</option></select></td></tr>
				<tr><th>Promotional banner</th><td><label><input type="checkbox" name="thor_app_options[banner_on]" value="1" <?php checked( $o['banner_on'] ); ?>> Enable the <code>[thor_app_banner]</code> section and show it above the footer</label><br>
					<input class="regular-text" name="thor_app_options[banner_title]" value="<?php echo esc_attr( $o['banner_title'] ); ?>"><br><textarea class="large-text" rows="2" name="thor_app_options[banner_text]"><?php echo esc_textarea( $o['banner_text'] ); ?></textarea></td></tr>
				<tr><th>Button labels</th><td><?php foreach ( array( 'quotes_text' => 'Get Repair Quotes', 'request_text' => 'Request a Repair', 'find_text' => 'Find an Engineer', 'track_text' => 'Track My Repair', 'login_text' => 'Customer login', 'engineer_text' => 'Engineer registration' ) as $k => $label ) : ?>
					<label style="display:block;margin-bottom:4px"><?php echo esc_html( $label ); ?>: <input class="regular-text" name="thor_app_options[<?php echo esc_attr( $k ); ?>]" value="<?php echo esc_attr( $o[ $k ] ); ?>"></label><?php endforeach; ?></td></tr>
				<tr><th><label for="exclude_pages">Exclude pages</label></th><td><input id="exclude_pages" class="regular-text" name="thor_app_options[exclude_pages]" value="<?php echo esc_attr( $o['exclude_pages'] ); ?>"><p class="description">Comma-separated page IDs or slugs where the floating button and banner are hidden.</p></td></tr>
				<tr><th>Repair enquiry integration</th><td><label><input type="checkbox" name="thor_app_options[intake_on]" value="1" <?php checked( $o['intake_on'] ); ?>> Forward Contact Form 7 quote submissions to the Thor Computer app</label><br>
					Form ID: <input size="8" name="thor_app_options[cf7_form_id]" value="<?php echo esc_attr( $o['cf7_form_id'] ); ?>"><br>
					<label>Consent wording shown to the visitor (add a matching acceptance field named <code>thor-consent</code> to the form):<br><textarea class="large-text" rows="2" name="thor_app_options[consent_text]"><?php echo esc_textarea( $o['consent_text'] ); ?></textarea></label></td></tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2>Shortcodes</h2>
		<p><code>[thor_app_download text="Get the Thor Computer App" style="solid|outline" align="left|center|right"]</code> &nbsp; <code>[thor_app_banner]</code></p>
		<p><code>[thor_app_button action="quotes|request|find|track|login|engineer|install" text="" style="solid|outline|cta" align=""]</code> &nbsp; <code>[thor_repair_form]</code> (native repair request form, uses the same secure intake and consent rules)</p>
	</div>
	<?php
}

add_filter( 'plugin_action_links_' . plugin_basename( THOR_APP_DIR . 'thor-computer-app-integration.php' ), function ( $l ) {
	array_unshift( $l, '<a href="' . esc_url( admin_url( 'options-general.php?page=thor-app' ) ) . '">Settings</a>' );
	return $l;
} );
