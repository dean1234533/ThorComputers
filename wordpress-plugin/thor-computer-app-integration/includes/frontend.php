<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** The button simply links to the app's /install page. That page detects the device and either triggers the browser's install prompt or shows iOS steps. */
function thor_app_install_url( $source = 'wp' ) {
	$o = thor_app_opts();
	return add_query_arg( 'src', rawurlencode( $source ), trailingslashit( $o['app_url'] ) . 'install' );
}

function thor_app_is_excluded() {
	$o = thor_app_opts();
	if ( '' === trim( $o['exclude_pages'] ) || ! is_singular() ) { return false; }
	$list = array_filter( array_map( 'trim', explode( ',', $o['exclude_pages'] ) ) );
	$post = get_queried_object();
	return in_array( (string) $post->ID, $list, true ) || in_array( $post->post_name, $list, true );
}

add_action( 'wp_enqueue_scripts', function () {
	wp_register_style( 'thor-app', THOR_APP_URL . 'assets/thor-app.css', array(), THOR_APP_VERSION );
} );
function thor_app_need_css() { wp_enqueue_style( 'thor-app' ); }

add_shortcode( 'thor_app_download', function ( $atts ) {
	$o = thor_app_opts();
	$a = shortcode_atts( array( 'text' => $o['button_text'], 'style' => 'solid', 'align' => 'left' ), $atts, 'thor_app_download' );
	thor_app_need_css();
	$style = ( 'outline' === $a['style'] ) ? 'thor-app-btn--outline' : 'thor-app-btn--solid';
	$align = in_array( $a['align'], array( 'left', 'center', 'right' ), true ) ? $a['align'] : 'left';
	return sprintf( '<div class="thor-app-wrap thor-app-align-%s"><a class="thor-app-btn %s" href="%s" rel="noopener">%s</a></div>', esc_attr( $align ), esc_attr( $style ), esc_url( thor_app_install_url( 'shortcode' ) ), esc_html( $a['text'] ) );
} );

function thor_app_banner_html( $source ) {
	$o = thor_app_opts();
	thor_app_need_css();
	return sprintf(
		'<section class="thor-app-banner" aria-label="%1$s"><div class="thor-app-banner__in"><div><h2>%1$s</h2><p>%2$s</p></div><a class="thor-app-btn thor-app-btn--cta" href="%3$s" rel="noopener">%4$s</a></div></section>',
		esc_html( $o['banner_title'] ), esc_html( $o['banner_text'] ), esc_url( thor_app_install_url( $source ) ), esc_html( $o['button_text'] )
	);
}
add_shortcode( 'thor_app_banner', function () { return thor_app_banner_html( 'banner_shortcode' ); } );

add_action( 'wp_footer', function () {
	$o = thor_app_opts();
	if ( is_admin() || thor_app_is_excluded() ) { return; }
	if ( $o['banner_on'] ) { echo thor_app_banner_html( 'banner_footer' ); } // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in builder
	if ( $o['floating_on'] ) {
		thor_app_need_css();
		printf( '<a class="thor-app-float thor-app-float--%s" href="%s" rel="noopener">%s</a>', esc_attr( $o['floating_pos'] ), esc_url( thor_app_install_url( 'floating' ) ), esc_html( $o['floating_text'] ) );
	}
}, 20 );

/** App entry points. Every path is a stable route on the app (see web/src/App.tsx). */
function thor_app_action_url( $action, $source ) {
	$o = thor_app_opts();
	$paths = array( 'quotes' => 'request', 'request' => 'request', 'find' => 'find-engineer', 'track' => 'track', 'login' => 'login', 'engineer' => 'engineer-signup', 'install' => 'install' );
	$path = isset( $paths[ $action ] ) ? $paths[ $action ] : 'install';
	return add_query_arg( 'src', rawurlencode( $source ), trailingslashit( $o['app_url'] ) . $path );
}
add_shortcode( 'thor_app_button', function ( $atts ) {
	$o = thor_app_opts();
	$labels = array( 'quotes' => $o['quotes_text'], 'request' => $o['request_text'], 'find' => $o['find_text'], 'track' => $o['track_text'], 'login' => $o['login_text'], 'engineer' => $o['engineer_text'], 'install' => $o['button_text'] );
	$a = shortcode_atts( array( 'action' => 'request', 'text' => '', 'style' => 'solid', 'align' => 'left' ), $atts, 'thor_app_button' );
	$action = isset( $labels[ $a['action'] ] ) ? $a['action'] : 'request';
	thor_app_need_css();
	$style = in_array( $a['style'], array( 'solid', 'outline', 'cta' ), true ) ? $a['style'] : 'solid';
	$align = in_array( $a['align'], array( 'left', 'center', 'right' ), true ) ? $a['align'] : 'left';
	return sprintf( '<div class="thor-app-wrap thor-app-align-%s"><a class="thor-app-btn thor-app-btn--%s" href="%s" rel="noopener">%s</a></div>', esc_attr( $align ), esc_attr( $style ), esc_url( thor_app_action_url( $action, 'shortcode_' . $action ) ), esc_html( '' !== $a['text'] ? $a['text'] : $labels[ $action ] ) );
} );

add_shortcode( 'thor_repair_form', function () {
	$o = thor_app_opts();
	thor_app_need_css();
	$msg = array( 'sent' => 'Thanks. Check your email to confirm your request, then approved engineers will send you quotes.', 'consent' => 'Please tick the consent box so we can share your enquiry with engineers.',
		'invalid' => 'Please enter a valid email address and describe the problem.', 'busy' => 'You have sent several requests recently. Please try again later.', 'expired' => 'The form expired. Please try again.', 'error' => 'Sorry, we could not send your request just now. Please try again or call us.' );
	$state = isset( $_GET['thor_request'] ) ? sanitize_key( wp_unslash( $_GET['thor_request'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification -- display only
	$devices = array( 'laptop' => 'Laptop', 'desktop' => 'Desktop PC', 'gaming_pc' => 'Gaming PC', 'mac' => 'Mac', 'phone' => 'Mobile phone', 'tablet' => 'Tablet', 'printer' => 'Printer', 'other' => 'Other technology' );
	$methods = array( 'home' => 'Engineer home visit', 'office' => 'Business premises visit', 'remote' => 'Remote assistance', 'workshop' => 'Workshop repair', 'collection' => 'Collection and return' );
	ob_start(); ?>
	<form id="thor-repair-form" class="thor-app-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<?php if ( isset( $msg[ $state ] ) ) : ?><p class="thor-app-form__msg thor-app-form__msg--<?php echo 'sent' === $state ? 'ok' : 'bad'; ?>" role="status"><?php echo esc_html( $msg[ $state ] ); ?></p><?php endif; ?>
		<input type="hidden" name="action" value="thor_repair_request"><?php wp_nonce_field( 'thor_repair_request', 'thor_nonce' ); ?>
		<p class="thor-app-hp" aria-hidden="true"><label>Website <input type="text" name="thor_website" tabindex="-1" autocomplete="off"></label></p>
		<p><label>First name<input required name="first_name" maxlength="80" autocomplete="given-name"></label></p>
		<p><label>Email<input required type="email" name="email" maxlength="120" autocomplete="email"></label></p>
		<p><label>Phone<input type="tel" name="phone" maxlength="30" autocomplete="tel"></label></p>
		<p><label>Postcode<input required name="postal_code" maxlength="10" autocomplete="postal-code"></label></p>
		<p><label>Device<select name="device_type"><?php foreach ( $devices as $k => $v ) { printf( '<option value="%s">%s</option>', esc_attr( $k ), esc_html( $v ) ); } ?></select></label></p>
		<p><label>Make<input name="brand" maxlength="60"></label> <label>Model<input name="model" maxlength="80"></label></p>
		<p><label>What is wrong?<textarea required name="problem" maxlength="2000" rows="4"></textarea></label></p>
		<p><label>Preferred repair method<select name="service_method"><?php foreach ( $methods as $k => $v ) { printf( '<option value="%s">%s</option>', esc_attr( $k ), esc_html( $v ) ); } ?></select></label></p>
		<p><label>Urgency<select name="urgency"><option value="flexible">Flexible</option><option value="soon">Within a few days</option><option value="urgent">Urgent</option></select></label></p>
		<p><label class="thor-app-form__consent"><input type="checkbox" name="thor_consent" value="1" required> <?php echo esc_html( $o['consent_text'] ); ?></label></p>
		<p><button type="submit" class="thor-app-btn thor-app-btn--cta"><?php echo esc_html( $o['quotes_text'] ); ?></button></p>
	</form>
	<?php
	return ob_get_clean();
} );
