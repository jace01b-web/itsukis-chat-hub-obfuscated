window.onload = function() {
    // Checks if the script is running inside our custom-named iframe. 
    // If yes, we are already in the cloaked tab, so stop the script.
    if (window.name === 'cloaked-frame') {
        return; 
    }

    window.addEventListener('click', function cloakSite() {
        let blankWindow = window.open('about:blank', '_blank');
        
        if (!blankWindow) {
            console.log("Pop-up blocked! Please allow pop-ups for this site.");
            return;
        }

        let iframe = blankWindow.document.createElement('iframe');
        
        // Give the iframe a specific internal name to detect it later
        iframe.name = 'cloaked-frame';
        
        // Grab the exact current URL without modifying it, preventing the ERR_FILE_NOT_FOUND error
        iframe.src = window.location.href;
        
        iframe.style.width = '100vw';
        iframe.style.height = '100vh';
        iframe.style.border = 'none';
        iframe.style.margin = '0';
        iframe.style.padding = '0';
        
        blankWindow.document.body.style.margin = '0';
        blankWindow.document.body.style.overflow = 'hidden';
        
        blankWindow.document.title = "Cloaked Tab";
        
        blankWindow.document.body.appendChild(iframe);

        // Remove the listener from the original page
        window.removeEventListener('click', cloakSite);
    });
};
