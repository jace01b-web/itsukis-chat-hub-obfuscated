/* ==========================================================================
 * js/games/hub-info.js
 * Shared Game Hubs info (display names/descriptions). To add a hub: add it to apps.json, then add one line here
 * Plain (non-module) script that runs in place while the page is parsed - see its <script> tag in index.html.
 * ========================================================================== */
/* Shared Game Hubs info. Keys = lowercase hub name from apps.json. Only hubs listed here are shown;
   n = display name, d = description (overrides apps.json), c/i = optional colour / icon fallback.
   To add a hub: add it to apps.json, then add one line here. */
window.HUB_INFO={
"kbh games":{n:"KBH Games",d:"More browser games to dig through. A few titles may be hit or miss."},
"reids games":{n:"Reids Games",d:"A solid game collection with some movies mixed in."},
"greeni":{n:"Greeni",d:"Movies and games together in one place."},
"polaris hub":{n:"Polaris Hub",d:"One of the biggest libraries here. Loads of games to scroll through."},
"wither games":{n:"Wither Games",d:"144 hand-picked popular and interesting games."},
"gn-math":{n:"GN-Math",d:"A well-known game site and a great first stop."},
"nautilusos":{n:"NautilusOS",d:"A polished, desktop-style interface with games inside."},
"ultimate game stash":{n:"Ultimate Game Stash",d:"One of the biggest stashes. Use search to find a specific game, like Pokémon Emerald."},
"sigma os":{n:"Sigma OS",d:"A Windows 11–style desktop with games and apps."},
"noah's tutoring":{n:"Noah's Tutoring",d:"A big game library. It can be a little laggy while it loads."},
"noah's tutoring launcher":{n:"Noah's Tutoring Launcher",d:"Same library as Noah's Tutoring, but opens behind a launch button."},
"lucide":{n:"Lucide",d:"Web proxy for reaching sites that are otherwise blocked. Works well.",c:"orange"},
"project bugs":{n:"Project Bugs",d:"A Google Sites page packed with games, with thumbnails so they're easy to browse.",c:"purple"},
"calcsolver":{n:"CalcSolver",d:"Looks like a calculator site. Turn on Code mode, then tap (0) four times to open the game hub.",c:"grey"},
"mantle":{n:"Mantle",d:"Quality over quantity: modded Minecraft, an AI assistant and a proxy in one app.",c:"red"},
"fern":{n:"Fern",d:"Another web proxy for opening blocked sites.",c:"lime"},
"game 'n go games 1":{n:"Game 'N Go Games 1",d:"A game hub that looks and feels like a computer desktop.",c:"cyan"},
"game 'n go games 2":{n:"Game 'N Go Games 2",d:"Backup mirror of Game 'N Go, handy if the first one is down.",c:"cyan"},
"zaka":{n:"Zaka",d:"Zaka's web proxy for opening blocked sites.",c:"blue"},
"bestspark":{n:"BestSpark",d:"A collection of game hubs plus original games made by the community.",c:"lime"},
"gust":{n:"Gust",d:"Another game hub to try when your usual ones are blocked.",c:"white"},
"unblockedzone!":{n:"UnblockedZone!",d:"A very popular game site that keeps several mirrors as backups.",c:"red"},
"idk 10.0":{n:"idk 10.0",d:"A desktop-style game hub with a big selection of games.",c:"purple"},
"ghost hub cinema":{n:"Ghost Hub Cinema",d:"A collection of movies to browse and watch.",c:"white"}
};

/* Non-hub sections of apps.json. Same idea: key = lowercase name, only listed items show. */
window.HUB_INFO_X={
apps:{
"basik (chat)":{n:"BaSik",i:"BaSik",c:"blue",d:"Super lightweight text-only chat. No roles, no images, just messages."},
"youtube v20":{n:"YouTube V20",i:"YT",c:"rose",d:"A YouTube player with playlists, settings and private + public keys."},
"unicorn's hideout 🦄":{n:"Unicorn's Hideout 🦄",i:"🦄",c:"purple",d:"unicorngirl38's hideout."}
},
tools:{
"ai code editor":{n:"AI Code Editor",c:"violet",d:"Code editor with built-in AI that can replace, add and delete specific lines."},
"code editor":{n:"Code Editor",c:"blue",d:"Live HTML editor with an instant preview."},
"about:blank opener":{n:"about:blank Opener",c:"amber",d:"Opens files and sites in an about:blank tab. Some sites block this kind of cloaking."},
"timer":{n:"Timer",c:"orange",d:"Stopwatch and countdown timer in one."},
"local music player":{n:"Local Music Player",c:"rose",d:"Play music files straight from your own device."},
"file + folder viewer":{n:"File + Folder Viewer",c:"lime",d:"Browse the files and folders on your device."},
"groq api keys":{n:"Groq API Keys",c:"green",d:"Grab a free Groq API key for AI tools."},
"notes":{n:"Notes",c:"amber",d:"Quick notes saved right in your browser."},
"image to base64":{n:"Image to Base64",c:"green",d:"Turn an image into base64 so you can embed it even when the image link is blocked."}
},
links:{
"scratch":{n:"Scratch",c:"orange",d:"Games, music and animations made by the Scratch community."},
"get youtube key":{n:"Get YouTube Key",c:"rose",d:"Step-by-step guide to getting a YouTube Data API v3 key."},
"google doodles":{n:"Google Doodles",c:"blue",d:"Minesweeper, Solitaire, Snake and lots more Google games."},
"cineby":{n:"Cineby",c:"yellow",d:"Movie and sports streaming. Not proxied, so some networks may block it."},
"code editor":{n:"Code Editor (Web)",c:"green",d:"A feature-packed online code editor."},
"cps test":{n:"CPS Test",c:"orange",d:"Test how many clicks per second you can hit."}
}
};
