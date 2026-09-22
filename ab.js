window.onload = function() {
    // Checks if the script is running inside our custom-named iframe. 
    if (window.name === 'cloaked-frame') {
        return; 
    }

    window.addEventListener('click', function cloakSite() {
        let blankWindow = window.open('about:blank', '_blank');
        
        if (!blankWindow) {
            alert("Pop-up blocked! Please allow pop-ups for this site.");
            return;
        }

        let iframe = blankWindow.document.createElement('iframe');
        
        iframe.name = 'cloaked-frame';
        
        // Use the /embed/ path to bypass p5.js iframe restrictions
        iframe.src = 'https://editor.p5js.org/jace01b/embed/mYFtQwQgD';
        
        iframe.style.width = '100vw';
        iframe.style.height = '100vh';
        iframe.style.border = 'none';
        iframe.style.margin = '0';
        iframe.style.padding = '0';
        
        blankWindow.document.body.style.margin = '0';
        blankWindow.document.body.style.overflow = 'hidden';
        
        blankWindow.document.title = "Dashboard";
        
        blankWindow.document.body.appendChild(iframe);

        window.location.replace('https://classroom.google.com/');

        window.removeEventListener('click', cloakSite);
    });
};
