var datainfoshown = false;

function initcookies() {
    
    if(localStorage.getItem("gefaengnishefte_cookies") == "true"){
        showcookiecontent();
    }
    else {
        hidecookiecontent();
    }
    
}

function cookies(choice) {
    document.getElementById("databanner").style.display = "none";

    if(choice) {
        localStorage.setItem("gefaengnishefte_cookies", choice);
    }

    initcookies();
}

window.addEventListener("beforeunload", function(e){
    cleartpcookies()
});

function cleartpcookies() {
    var currentchoice = localStorage.getItem("gefaengnishefte_cookies")
    var currentlanguage = localStorage.getItem("gefaengnishefte_language")
    clearcookies()
    localStorage.setItem("gefaengnishefte_cookies", currentchoice);
    localStorage.setItem("gefaengnishefte_language", currentlanguage);
}

function clearcookies() {
    sessionStorage.clear();
    localStorage.clear();

    var cookies = document.cookie.split(";");

    for (var i = 0; i < cookies.length; i++) {
        var cookie = cookies[i];
        var eqPos = cookie.indexOf("=");
        var name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
}

function showcookiecontent() {
    var frames = document.getElementsByTagName("iframe")
    
    for (let i = 0; i < frames.length; i++)
    {
        let frameURL = frames[i].innerHTML

        if(frames[i].getAttribute('data-source') !== "youtube") {
            frames[i].removeAttribute("sandbox")
            frames[i].frameborder = "0"
            frames[i].innerHTML = ""
            frames[i].src = frameURL
            frames[i].style.display = "block"
        }
        else {
            frames[i].style.display = "none"
            frames[i].frameborder = "0"
            frames[i].title = "YouTube video player"
            frames[i].allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            frames[i].setAttribute('allowFullScreen', '')

            let thumbnail = document.createElement("img")

            thumbnail.src = "https://img.youtube.com/vi/" + frames[i].getAttribute('data-id') + "/mqdefault.jpg"
            thumbnail.classList.add("thumbnail");
            thumbnail.classList.add(frames[i].className);

            frames[i].parentNode.insertBefore(thumbnail, frames[i])
        }
    }
    
    var cookiedisclaimers = document.getElementsByClassName("cookiedisclaimer")

    for (let i = 0; i < cookiedisclaimers.length; i)
    {
        cookiedisclaimers[i].remove();
    }

    datainfoshown = false;
    cleartpcookies()
    if(typeof variable !== 'undefined') {console.log("test"); loadframes()}
}

function loadframe(frames, current) {
    if(localStorage.getItem("gefaengnishefte_cookies") == "true" && current < frames.length) {

        if(frames[current].getAttribute('data-source') == "youtube") {
            let frame = frames[current]
            let thumbnail = frame.previousSibling
            
            frame.removeAttribute("sandbox")

            if(frame.getAttribute('data-list') !== null) {
                frame.src = "https://www.youtube-nocookie.com/embed/" + frame.getAttribute('data-id') + "?list=" + frame.getAttribute('data-list')
            }
            else {
                frame.src = "https://www.youtube-nocookie.com/embed/" + frame.getAttribute('data-id') + "?modestbranding=1&enablejsapi=1"
            }
            
            frame.onload = function(){
                thumbnail.style.display = "none"
                frame.style.display = "block"
                loadframe(frames, current + 1)
            };
            
        }
        else {
            loadframe(frames, current + 1)
        }
    }
    cleartpcookies()
}

function hidecookiecontent() {
    
    if(!datainfoshown) {
        
        var frames = document.getElementsByTagName("iframe")
        
        for (let i = 0; i < frames.length; i++)
        {
            var cookiedisclaimer = document.createElement("span");
            cookiedisclaimer.innerHTML = "<span lang='de'>Dieser Inhalt erfordert die <span style='text-decoration: underline; cursor: pointer;' onclick='showdatabanner()'>Zustimmung zu Cookies</span>.</span><span lang='en'>This content requires your <span style='text-decoration: underline; cursor: pointer;' onclick='showdatabanner()'>consent to the use of cookies</span>.</span>";
            cookiedisclaimer.className = "cookiedisclaimer";
            
            // frames[i].style.display = "none"
            frames[i].parentNode.insertBefore(cookiedisclaimer, frames[i])
            
            datainfoshown = true;
        }
    }
}

function showdatabanner() {
    document.getElementById("databanner").style.display = "block";
}