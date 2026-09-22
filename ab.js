(function() {
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
        
        // Target the parent launcher URL instead of the iframe's 'about:srcdoc'
        let targetUrl;
        try {
            targetUrl = window.top.location.href;
        } catch (e) {
            // Fallback just in case cross-origin restrictions apply
            targetUrl = window.location.href;
        }
        
        iframe.src = targetUrl;
        
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
})();
