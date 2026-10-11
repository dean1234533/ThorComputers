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
