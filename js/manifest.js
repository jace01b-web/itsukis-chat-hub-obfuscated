/* ==========================================================================
 * js/manifest.js - the one list of files the site loads.
 *
 *   css : stylesheets inside /css, applied in this order (later files override earlier ones).
 *         NOTE: index.html fetches the stylesheets itself (it has to - they come from the raw repo,
 *         which browsers refuse to apply through <link>), so the CSS list that actually loads is the
 *         one in index.html. This copy must be kept identical to it; it is the documentation of the
 *         order, and the single-file build in dist/ uses it.
 *   js  : scripts inside /js, executed in this order. They share one global scope, so a file can
 *         only USE things at load time that an earlier file already defined. (Functions that are
 *         merely called later, from clicks/timers/etc., can live anywhere.)
 *
 * To add a feature: create the file, then add its path here.
 * ========================================================================== */
window.APP_MANIFEST={
  firebase:{version:"10.12.2",modules:["firebase-app","firebase-auth","firebase-app-check","firebase-database"],storage:"firebase-storage"},
  css:[
    "00-discord-theme.css",
    "01-base.css",
    "02-now-playing.css",
    "03-form-controls.css",
    "04-layout-background.css",
    "05-auth-home-basics.css",
    "06-chat.css",
    "07-modals-pickers.css",
    "08-overlays-friends.css",
    "09-game-hubs.css",
    "10-profile-cropper-composer.css",
    "12-vip-spin.css",
    "13-auth-page.css",
    "14-extras-menu.css",
    "15-anti-lag.css",
    "16-rules-modal.css",
    "17-halloween.css",
    "18-music-profile-cosmetics.css",
    "19-mobile-sidebar.css",
    "20-voice-channel.css",
    "22-discord-look.css",
    "24-file-attachments.css",
    "25-custom-roles.css",
    "26-trick-or-treat.css",
    "99-discord-shell.css",
    /* Loaded LAST on purpose: it owns the layout geometry (sizes, spacing, type scale, radii,
       breakpoints) and has to be able to correct the older Discord-look layer above it. */
    "27-discord-exact.css",
    /* Loaded after it: fixes the image sizing that stylesheet broke, and styles the markup
       added in v53 (display names, spoilers, system messages, boosts). */
    "28-discord-plus.css",
    /* Last. Owns everything v54 added: the preference classes js/core/prefs.js sets on <html>,
       the rebuilt profile cards, pins, search, polls, the quick switcher, and the new settings
       and server panes. Last so it can correct the layers above it without !important wars. */
    "29-v54.css"
  ],
  /* Not loaded on purpose: 23-lockdown.css belongs to js/features/lockdown.js, which is kept in the
     repo but left out of the load list (its master switch is ON, so loading it would lock the site). */
  js:[
    "core/firebase-imports.js",
    "core/diagnostics.js",
    "core/config.js",
    "chat/emoji-data.js",
    "moderation/content-filter.js",
    "core/name-styles.js",
    "core/helpers.js",
    "core/firebase-init.js",
    "chat/file-upload.js",
    "moderation/roles.js",
    "discord/model.js",
    "moderation/nsfw-filter.js",
    "moderation/bans.js",
    "core/database.js",
    "core/state.js",
    /* v54: the preference layer. Declares only - it reads ME/DB at call time, never at load -
       so it is safe this early, and being this early is what makes the appearance preferences
       apply on the first paint instead of snapping in a second later. */
    "core/prefs.js",
    "features/gift-promo.js",
    "chat/pings.js",
    "core/auto-update.js",
    "core/sound.js",
    "tools/music-player.js",
    "tools/now-playing.js",
    "ui/controls.js",
    "ui/navigation.js",
    "auth/auth.js",
    "ui/modals.js",
    "ui/home.js",
    "features/vip-and-spin.js",
    "ui/sidebar-toggle.js",
    "games/game-hubs.js",
    "chat/chat-view.js",
    "social/user-profile.js",
    /* v54 profiles. profile-data.js first (profile-card.js uses its consts), and both AFTER
       user-profile.js, because profile-card.js takes over openUserProfile/openProfilePopout by
       reassigning them - which needs the originals to exist. */
    "social/profile-data.js",
    "social/profile-card.js",
    "chat/chat-header.js",
    "chat/messages.js",
    "chat/emoji-picker.js",
    "discord/markdown.js",
    "chat/text-and-media.js",
    "chat/composer.js",
    "ui/keyboard-shortcuts.js",
    "chat/attachments.js",
    /* v54 chat: pins, saved messages, search, the unread divider, @role and #channel mentions,
       and the ignore collapse. AFTER messages.js and composer.js, whose msgEl, renderMessages,
       selectRoom, updateMentionPop and extractPings it takes over. */
    "chat/chat-plus.js",
    /* Polls hook the same msgEl/selectRoom chain, so they load after chat-plus.js. */
    "chat/polls.js",
    /* v54: per-server/per-channel notification overrides and the one place that decides whether
       anything makes a noise. Before the settings panes, which draw its controls. */
    "settings/notif-prefs.js",
    "settings/appearance.js",
    "settings/rules.js",
    "settings/account.js",
    "settings/discord-settings.js",
    "settings/settings-page.js",
    /* v54 settings. AFTER both settings files, because it wraps SET_NAV, SET_PANES and
       wireDiscordSettings - all three have to exist for it to take them over. */
    "settings/settings-plus.js",
    "features/halloween.js",
    "features/trick-or-treat-games.js",
    "features/trick-or-treat.js",
    "settings/rules-check.js",
    "moderation/tos-gate.js",
    "settings/anti-lag.js",
    "social/friends.js",
    "chat/live-sync.js",
    "chat/typing-indicator.js",
    "ui/extras-menu.js",
    "ui/liquid-glass.js",
    "ui/discord-shell.js",
    "discord/ui.js",
    "discord/server-settings.js",
    "discord/boosts.js",
    "discord/shop.js",
    "discord/moderation.js",
    /* v54 server systems. AFTER server-settings.js (they call registerServerSection, which it
       defines) and after discord/markdown.js and chat/emoji-picker.js, which emoji.js wraps. */
    "discord/audit.js",
    "discord/emoji.js",
    "discord/server-plus.js",
    /* v54: Ctrl+K. After the shell (it calls DiscordShell.openServer) and after the settings
       files (it lists every settings pane by reading SET_NAV). */
    "ui/quick-switcher.js",
    "ui/context-menu.js",
    "core/boot.js"
  ]
};
