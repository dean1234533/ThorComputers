<?php
/**
 * Plugin Name: Thor Computer App Integration
 * Description: Promotes the Thor Computer app (app.thorcomputer.com), adds install buttons/shortcodes, and securely forwards Contact Form 7 repair enquiries to the Thor Computer platform.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Thor Computer Ltd
 * License: GPL-2.0-or-later
 * Text Domain: thor-app
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'THOR_APP_VERSION', '1.0.0' );
define( 'THOR_APP_DIR', plugin_dir_path( __FILE__ ) );
define( 'THOR_APP_URL', plugin_dir_url( __FILE__ ) );

require_once THOR_APP_DIR . 'includes/settings.php';
require_once THOR_APP_DIR . 'includes/frontend.php';
require_once THOR_APP_DIR . 'includes/intake.php';
