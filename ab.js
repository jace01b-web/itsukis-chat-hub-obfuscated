window.onload = function() {
    // Checks if the script is running inside our custom-named iframe. 
    // If yes, we are already in the cloaked tab, so stop the script.
    if (window.name === 'cloaked-frame') {
        return; 
    }

    window.addEventListener('click', function cloakSite() {
        let blankWindow = window.open('about:blank', '_blank');
        
        if (!blankWindow) {
            // Switched to an alert so the user actually sees it 
            alert("Pop-up blocked! Please allow pop-ups for this site.");
            return;
        }

        let iframe = blankWindow.document.createElement('iframe');
        
        // Give the iframe a specific internal name to detect it later
        iframe.name = 'cloaked-frame';
        
        // Explicitly set the absolute URL to completely bypass the ERR_FILE_NOT_FOUND error
        iframe.src = 'https://editor.p5js.org/jace01b/full/mYFtQwQgD';
        
        iframe.style.width = '100vw';
        iframe.style.height = '100vh';
        iframe.style.border = 'none';
        iframe.style.margin = '0';
        iframe.style.padding = '0';
        
        blankWindow.document.body.style.margin = '0';
        blankWindow.document.body.style.overflow = 'hidden';
        
        // Set a decoy title to make the cloaked tab less suspicious
        blankWindow.document.title = "Dashboard";
        
        blankWindow.document.body.appendChild(iframe);

        // Optional: Redirect the original exposed tab to a safe site to cover tracks
        window.location.replace('https://classroom.google.com/');

        // Remove the listener from the original page
        window.removeEventListener('click', cloakSite);
    });
};
        // Remove the listener from the original page
        window.removeEventListener('click', cloakSite);
    });
};
