<?php
/**
 * Plugin Name:       LeadLoop
 * Description:       Adds the LeadLoop website tag to every page: captures your lead forms and loads your connected Meta, Google and TikTok ad pixels.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            LeadLoop
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       leadloop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Filled in by LeadLoop when you download the plugin from your dashboard.
// The site key is PUBLIC (it appears in your page source); it only works on
// the website domains you listed in LeadLoop.
define( 'LEADLOOP_DEFAULT_SITE_KEY', '{{LEADLOOP_SITE_KEY}}' );
define( 'LEADLOOP_SCRIPT_URL', '{{LEADLOOP_SCRIPT_URL}}' );
define( 'LEADLOOP_OPTION', 'leadloop_site_key' );

/** The configured site key, or '' when it isn't a valid key. */
function leadloop_site_key() {
	$key = get_option( LEADLOOP_OPTION, '' );
	if ( '' === $key || false === $key ) {
		$key = LEADLOOP_DEFAULT_SITE_KEY;
	}
	return leadloop_valid_key( $key ) ? $key : '';
}

function leadloop_valid_key( $key ) {
	return is_string( $key ) && 1 === preg_match( '/^site_[a-z0-9]{8,32}$/', $key );
}

/** Settings sanitiser: keep the old key when the new one is malformed. */
function leadloop_sanitize_key( $value ) {
	$value = strtolower( trim( sanitize_text_field( (string) $value ) ) );
	if ( '' === $value ) {
		return '';
	}
	if ( ! leadloop_valid_key( $value ) ) {
		add_settings_error( LEADLOOP_OPTION, 'leadloop_invalid', __( 'That does not look like a LeadLoop site key (it starts with "site_").', 'leadloop' ) );
		return get_option( LEADLOOP_OPTION, '' );
	}
	return $value;
}

/** Print the tag in <head> on every front-end page. */
function leadloop_print_tag() {
	if ( is_admin() ) {
		return;
	}
	$key = leadloop_site_key();
	if ( '' === $key ) {
		return;
	}
	printf(
		"<script src=\"%s\" data-site=\"%s\" defer></script>\n",
		esc_url( LEADLOOP_SCRIPT_URL ),
		esc_attr( $key )
	);
}
add_action( 'wp_head', 'leadloop_print_tag', 1 );

function leadloop_register_settings() {
	register_setting(
		'leadloop',
		LEADLOOP_OPTION,
		array(
			'type'              => 'string',
			'sanitize_callback' => 'leadloop_sanitize_key',
			'default'           => '',
		)
	);
}
add_action( 'admin_init', 'leadloop_register_settings' );

function leadloop_add_menu() {
	add_options_page( 'LeadLoop', 'LeadLoop', 'manage_options', 'leadloop', 'leadloop_render_settings' );
}
add_action( 'admin_menu', 'leadloop_add_menu' );

function leadloop_settings_link( $links ) {
	$url = admin_url( 'options-general.php?page=leadloop' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'leadloop' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'leadloop_settings_link' );

function leadloop_render_settings() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$key    = leadloop_site_key();
	$stored = get_option( LEADLOOP_OPTION, '' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'LeadLoop', 'leadloop' ); ?></h1>
		<?php settings_errors( LEADLOOP_OPTION ); ?>
		<?php if ( '' !== $key ) : ?>
			<div class="notice notice-success inline"><p>
				<?php
				printf(
					/* translators: %s: site key */
					esc_html__( 'Active — the LeadLoop tag is added to every page with site key %s.', 'leadloop' ),
					'<code>' . esc_html( $key ) . '</code>'
				);
				?>
			</p></div>
			<p><?php esc_html_e( 'Open your website in a new tab once, then use "Check my website" in LeadLoop to confirm.', 'leadloop' ); ?></p>
		<?php else : ?>
			<div class="notice notice-warning inline"><p><?php esc_html_e( 'Not active — add your site key below.', 'leadloop' ); ?></p></div>
		<?php endif; ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'leadloop' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="leadloop_site_key"><?php esc_html_e( 'Site key', 'leadloop' ); ?></label></th>
					<td>
						<input name="<?php echo esc_attr( LEADLOOP_OPTION ); ?>" id="leadloop_site_key" type="text" class="regular-text code"
							value="<?php echo esc_attr( $stored ); ?>"
							placeholder="<?php echo esc_attr( leadloop_valid_key( LEADLOOP_DEFAULT_SITE_KEY ) ? LEADLOOP_DEFAULT_SITE_KEY : 'site_…' ); ?>" />
						<p class="description"><?php esc_html_e( 'Leave empty to use the key this plugin was downloaded with. Find it in LeadLoop → Settings → Ads & tracking → Website.', 'leadloop' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

function leadloop_uninstall() {
	delete_option( LEADLOOP_OPTION );
}
register_uninstall_hook( __FILE__, 'leadloop_uninstall' );
