/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////// GENERAL ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////




// GENERAL VARIABLES

var TIMEOUT_IDS = []



// COMPONENT LOADING

var componentsloaded = 0
var componentsneeded = 0

function fetchcomponents(components) {
	componentsneeded = components.length
	
	for (let i = 0; i < components.length; i++) {
		fetchHTML("components/" + components[i] + ".html", components[i])
	}
}

async function fetchHTML(URL, ID) {
	fetch(URL)
	.then(response => response.text())
	.then(value => {loadElement(ID, value)});
}

function loadElement(ID, HTML) {
    // console.log(document.readyState)
    // console.log("load " + ID)
    if (document.readyState == "loading") {
        setTimeout(loadElement, 20, ID, HTML);
    }
    else {
        document.getElementById(ID).innerHTML = HTML

        componentsloaded++
        if(componentsloaded >= componentsneeded) {
			init()
		}
    }
}



// INIT

function initcommon() {
    initcookies();
    initlanguage();
    initabo();
    inithighlights();
    init_scrollbar()

    window.addEventListener("resize", openmenufix)
}

function initfooter() {
    limit_buttons(layoutCurrent, layoutList, "to-top", "to-bottom")
    initfootnotes()
}


// HEIGHTFIX

let vh = window.innerHeight * 0.01;
document.documentElement.style.setProperty('--vh', `${vh}px`);

window.addEventListener('resize', () => {
	let vh = window.innerHeight * 0.01;
	document.documentElement.style.setProperty('--vh', `${vh}px`);
});




/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////// SCROLLBAR ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// SCROLLBAR FOR INDEX

function init_scrollbar() {
    document.getElementById("content").addEventListener("scroll", () => {
        reset_scrollbar('--scrollbar-color', '--default-scrollbar-color', "scrollbar", 3000)
    });
    document.getElementById("slideIndex").addEventListener("scroll", () => {
        reset_scrollbar('--scrollbar-color-index', '--default-scrollbar-color-index', "scrollbar_index", 10000)
    })
}


function reset_scrollbar(color_var, color_default, timeoutID, time) {

    color_default = getComputedStyle(document.documentElement).getPropertyValue(color_default)
    document.documentElement.style.setProperty(color_var, color_default);

    clearTimeout(TIMEOUT_IDS[timeoutID])
    TIMEOUT_IDS[timeoutID] = setTimeout(hide_scrollbar, time, color_var);
}


function hide_scrollbar(color_var) {
    document.documentElement.style.setProperty(color_var, 'transparent');
}


function reset_scroll() {
    document.getElementById("content").scrollTop = 0;
    document.documentElement.scrollTop = 0;
    setTimeout(hide_scrollbar, 1, '--scrollbar-color');
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////// LIB ///////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// RESSETTING

function limit_buttons(current, list, first, last) {
    
    if (current==0) {
        disable(first)
    }
    else {
        enable(first)
    }
    
    if (current>=list.length-1) {
        disable(last)
    }
    else {
        enable(last)
    }
}

function disable(element) {
    element = document.getElementById(element)
    element.disabled = true;
    element.style.color = "lightgrey";
}

function enable(element) {
    element = document.getElementById(element)
    element.disabled = false;
    element.style.color = "white";
}



// VIDEO PAUSER

function pausevideos() {
	var frames = document.getElementsByTagName("iframe")

	for (let i = 0; i < frames.length; i++)
	{
        if(frames[i].getAttribute('data-source') == "youtube") {
            frames[i].contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
        }
	}
}







/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////// BACK-END ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////







/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////// LANGUAGE ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


function initlanguage() {
    if(localStorage.getItem("gefaengnishefte_language") == null){localStorage.setItem("gefaengnishefte_language", "de")}
    
	setlanguage(localStorage.getItem("gefaengnishefte_language"))
}

function setlanguage(language) {

	document.querySelectorAll('[lang="de"], [lang="en"]').forEach((item) => {item.hidden = true;})
    document.querySelectorAll('#lang-de, #lang-en').forEach((item) => {item.style.textDecoration = "none";})
	document.getElementById("lang-" + language).style.textDecoration = "underline"
	document.querySelectorAll('*:lang(' + language + '):not(br)').forEach((item) => {item.hidden = false;})

	localStorage.setItem("gefaengnishefte_language", language);	
}






/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////// COOKIES ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////



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


function showdatabanner() {
    document.getElementById("databanner").style.display = "block";
}


// CLEARING

window.addEventListener("beforeunload", cleartpcookies);


function cleartpcookies() {

    let fpcookies = {}

    for (let [key, value] of Object.entries(localStorage)) {
        if(key.includes("gefaengnishefte_")) {fpcookies[key] = value}    
    }

    clearcookies()

    for (let [key, value] of Object.entries(fpcookies)) {
        localStorage.setItem(key, value)
    }
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


// SHOWING/HIDING COOKIECONTENT

function showcookiecontent() {
    var frames = document.getElementsByTagName("iframe")
    
    for (let i = 0; i < frames.length; i++)
    {
        let frame = frames[i]

        if(frame.getAttribute('data-source') == "youtube") {
            frame.style.display = "none"
            frame.frameborder = "0"
            frame.title = "YouTube video player"
            frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            frame.setAttribute('allowfullScreen', '')

            let thumbnail = document.createElement("img")

            thumbnail.src = "https://img.youtube.com/vi/" + frame.getAttribute('data-id') + "/mqdefault.jpg"
            thumbnail.classList.add("thumbnail");
            thumbnail.classList.add(frame.className);

            frame.parentNode.insertBefore(thumbnail, frame)
        }
        else if(frame.getAttribute('data-source') == "spotify") {
            frame.removeAttribute("sandbox")
            frame.width = "700"
            frame.height = "232"
            frame.style.borderRadius = "12px"
            frame.frameborder = "0"
            frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            frame.setAttribute('allowfullScreen', '')
            frame.src = "https://open.spotify.com/embed/episode/" + frame.getAttribute('data-id') + "?utm_source=generator&theme=0"
            frame.style.display = "block"
        }
        else {
            frame.removeAttribute("sandbox")
            frame.frameborder = "0"
            frame.src = frame.innerHTML
            frame.innerHTML = ""
            frame.style.display = "block"
        }
    }
    
    var cookiedisclaimers = document.getElementsByClassName("cookiedisclaimer")

    for (let i = 0; i < cookiedisclaimers.length; i)
    {
        cookiedisclaimers[i].remove();
    }

    datainfoshown = false;
    cleartpcookies()

    if(document.getElementById("slides")){loadframes()}
}

function hidecookiecontent() {
    
    if(!datainfoshown) {
        
        var frames = document.getElementsByTagName("iframe")
        
        for (let i = 0; i < frames.length; i++)
        {
            var cookiedisclaimer = document.createElement("span");
            cookiedisclaimer.innerHTML = "<span lang='de'>Dieser Inhalt erfordert die <span style='text-decoration: underline; cursor: pointer;' onclick='showdatabanner()'>Zustimmung zu Cookies</span>.</span><span lang='en'>This content requires your <span style='text-decoration: underline; cursor: pointer;' onclick='showdatabanner()'>consent to the use of cookies</span>.</span>";
            cookiedisclaimer.className = "cookiedisclaimer";
            
            frames[i].style.display = "none"
            frames[i].parentNode.insertBefore(cookiedisclaimer, frames[i])
            
            datainfoshown = true;
        }
    }
}


// FRAME LOADING

function loadframes() {
    loadframe(document.getElementById(slideList[currentSlide]).getElementsByTagName("iframe"), 0, currentSlide)
}


function loadframe(frames, current, slide) {
    if(localStorage.getItem("gefaengnishefte_cookies") == "true" && current < frames.length && slide == currentSlide) {

        if(frames[current].getAttribute('data-source') == "youtube" && frames[current].getAttribute('data-loaded') != "true") {
            let frame = frames[current]
            let thumbnail = frame.previousSibling
            
            frame.removeAttribute("sandbox")

            if(frame.getAttribute('data-list') !== null) {
                frame.src = "https://www.youtube-nocookie.com/embed/" + frame.getAttribute('data-id') + "?modestbranding=1&enablejsapi=1" + "?list=" + frame.getAttribute('data-list')
            }
            else if (frame.getAttribute('data-timestamp') !== null){
                frame.src = "https://www.youtube-nocookie.com/embed/" + frame.getAttribute('data-id') + "?modestbranding=1&enablejsapi=1" + "?t=" + frame.getAttribute('data-timestamp')
            }
            else {
                frame.src = "https://www.youtube-nocookie.com/embed/" + frame.getAttribute('data-id') + "?modestbranding=1&enablejsapi=1"
            }
            
            frame.onload = function(){
                thumbnail.remove();
                frame.style.display = "block"
                frame.setAttribute('data-loaded', 'true')
                loadframe(frames, current + 1 , slide)
            };
            
        }
        else {
            // if( frames[current].getAttribute('data-loaded') == "true") {
            //     console.log("skipped load - was loaded")
            // }
            loadframe(frames, current + 1 , slide)
        }
    }
    // else if(slide != currentSlide) {
    //     console.log("load aborted")
    // }
    cleartpcookies()
}








/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////// ABO //////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// ABONNIEREN

var emailinfodisabled = false;


function make_table(data) {
    let table = {}

    for (let [key, value] of data) {
        table[key] = value
    }

    return table
}


function fetch_mail(content) {

    fetch("https://formsubmit.co/ajax/6d2bd15bcc3410a47e44b78943d390d0", {
        method: "POST",
        headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(content)
    })
        .then(response => response.json())
        .then(data => console.log(data))
        .catch(error => console.log(error));
}


function submit_email(event) {
	event.preventDefault()

    let data = new FormData(event.target)
    data.append('Code', makeid(40));
    fetch_mail(make_table(data))

	document.getElementById("email-btn").innerHTML = '<span lang="de">Abonniert!</span><span lang="en">Subscribed!</span>';
	document.getElementById("email-btn").disabled = true;
	document.getElementById("email-info").style.display = "none";
	document.getElementById("email-checkbox").checked = false;
	emailinfodisabled = true;
	initlanguage() //needed bc it changes DOM
}


function remove_email(event) {
    event.preventDefault()

    let data = new FormData(event.target)
    fetch_mail(make_table(data))

    document.getElementById("email-deabo-btn").innerHTML = '<span lang="de">Deabonniert.</span><span lang="en" hidden>Unsubscribed.</span>';
    document.getElementById("email-deabo-btn").disabled = true;
	initlanguage() //needed bc it changes DOM
}


function confirm_email() {
    const params = new Proxy(new URLSearchParams(window.location.search), {
        get: (searchParams, prop) => searchParams.get(prop),
    });
    
    let table = {}
    table["Code"] = params.code;
    table["_subject"] = "Bestätigungsmail"
    table["_captcha"] = true
    
    fetch_mail(table)
    document.getElementById("email-confirm-info").innerHTML = "<span lang='de'>Deine E-mail wurde erfolgreich bestätigt!</span><span lang='en'>Your E-Mail has been confirmed successfully!</span>";
	initlanguage() //needed bc it changes DOM
}


function input_remove_email() {
    document.getElementById("email-deabo-btn").innerHTML = '<span lang="de">Deabonnieren</span><span lang="en" hidden>Unsubscribe</span>';
    document.getElementById("email-deabo-btn").disabled = false;
	initlanguage() //needed bc it changes DOM
}


function input_email() {
	document.getElementById("email-btn").innerHTML = '<span lang="de">Abonnieren</span><span lang="en">Subscribe</span>';
	document.getElementById("email-btn").disabled = false;
	emailinfodisabled = false;
	showemailinfo()
	initlanguage() //needed bc it changes DOM
}


function showemailinfo() {
	if(!emailinfodisabled) {
		document.getElementById("email-info").style.display = "block"
	}
}


// SWITCH ABO TYPE

function initabo() {
    if(localStorage.getItem("gefaengnishefte_abo") == null) {localStorage.setItem("gefaengnishefte_abo", "email")}
	setabo(localStorage.getItem("gefaengnishefte_abo"))



    // LISTENERS
	document.getElementById("email-form").addEventListener('submit', function(event){submit_email(event)})
    document.getElementById("email-form").addEventListener('input', input_email)
    if(document.getElementById("email-deabo-form")) {
        document.getElementById("email-deabo-form").addEventListener('submit', function(event){remove_email(event)})
        document.getElementById("email-deabo-form").addEventListener('input', input_remove_email);
    }
}

function setabo(type) {

	document.getElementById('email-form').style.display = "none";
	document.getElementById('telegram-form').style.display = "none"

	document.getElementById("email-opt").style.textDecoration = "none"
	document.getElementById("telegram-opt").style.textDecoration = "none"

	if(type == "telegram") {
		document.getElementById("email-info").style.display = "none"
	}

	document.getElementById(type + '-opt').style.textDecoration = "underline"
	document.getElementById(type + '-form').style.display = "flex";

	localStorage.setItem("gefaengnishefte_abo", type);	
}

// FOCUS

// document.getElementById("email-input").addEventListener('focus', (event) => {showemailinfo()});


// ID CREATION

function makeid(length) {
	var result           = '';
	var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	var charactersLength = characters.length;
	for ( var i = 0; i < length; i++ ) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}

	return result;
}







/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////// NAV //////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////// MENUS /////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// DROPMENU

var menuopen = false;
var windowwidth = window.innerWidth;


function openmenufix() {
	if (window.innerWidth!=windowwidth) {

		windowwidth = window.innerWidth;

		closemenu()

		if (window.innerWidth < 800 && !menuopen) {
			document.getElementById("openmenu").style.display = "inline";
		}
		else {
			document.getElementById("openmenu").style.display = "none";
		}
	}
}

function openmenu(menu, anchor) {
	hidedropmenus();
	document.getElementById(menu).style.height = "fit-content";
	document.getElementById(anchor).style.visibility = "visible";

	if (window.innerWidth > 800) {
		document.getElementById(menu).style.width = document.getElementById("navigation").offsetWidth + 201 + 'px'; // og value 30
	}
	else {
		document.getElementById(menu).style.width = "100vw";
		document.getElementById("headerlogo").style.visibility = "hidden";
		document.getElementById("openmenu").style.display = "none";
		document.getElementById("closemenu").style.display = "inline";
		document.documentElement.style.setProperty('--header-divider', `block`);
	}

	menuopen = true
}

function safeclosemenu() {
	if(document.getElementById("email-input") !== document.activeElement 
	&& document.getElementById("email-checkbox") !== document.activeElement 
	&& document.getElementById("email-btn") !== document.activeElement) 
	{
		closemenu()
		if(document.getElementById("email-input").value == "") {
			document.getElementById("email-info").style.display = "none"
			document.getElementById("email-checkbox").checked = false;
		}
	}
}

function closemenu() {

	hidedropmenus();

	if (window.innerWidth < 800) {
		document.getElementById("headerlogo").style.visibility = "visible";
		document.getElementById("closemenu").style.display = "none";
		document.getElementById("openmenu").style.display = "inline";
	}

	menuopen = false
}

function hidedropmenus() {
	var dropmenus = document.getElementsByClassName("dropmenu")

	for (let i = 0; i < dropmenus.length; i++)
	{
		dropmenus[i].style.width = "0vw";
		dropmenus[i].style.border = "none transparent";
	}
}



// NAVIGATION HIGHLIGHT

const highlights = {
    "": ["dropanchori", "descriptioni"],
    "/": ["dropanchori", "descriptioni"],
    "/issue-i": ["dropanchori", "descriptioni", "info-issue-i"],
    "/kanon": ["dropanchork", "descriptionk"],
    "/deabonnieren": ["etc", "descriptiond"],
    "/impressum": ["etc", "descriptionim"],
    "/datenschutz": ["etc", "descriptionda"],
}


function inithighlights() {

    let window_url = window.location.href.toLowerCase().slice(0, string.indexOf('#'))
    console.log(window_url)

    for (let [URLsnippet, IDs] of Object.entries(highlights)) {
        if (window_url == ("https://www.GEFAENGNISHEFTE.org" + URLsnippet).toLowerCase()) {
            for (var i = 0; i < IDs.length; i++ ) {
                console.log(URLsnippet + " highlight -> " + IDs[i])
                document.getElementById(IDs[i]).style.fontWeight = "700";
                return
            }
        }
    }
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////// VERTICAL NAVIGATION ///////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


var layoutCurrent = 0

function verticalup() {

    if(layoutCurrent > 0) {
        layoutCurrent = layoutCurrent - 1
        document.getElementById(layoutList[layoutCurrent]).scrollIntoView()
        limit_buttons(layoutCurrent, layoutList, "to-top", "to-bottom")
    }
}

function verticaldown() {

    if(layoutCurrent < layoutList.length - 1) {
        layoutCurrent = layoutCurrent + 1
        document.getElementById(layoutList[layoutCurrent]).scrollIntoView()
        limit_buttons(layoutCurrent, layoutList, "to-top", "to-bottom")
    }
}


function autosetlayout() {
    let scrollheight = document.getElementById("content").scrollTop
    let offsetheight = document.getElementById("content").offsetHeight

    layoutCurrent = 0;

    for (let i = 0; i < layoutList.length; i++) {

        let offsetTop = document.getElementById(layoutList[i]).offsetTop

        if(scrollheight >= offsetTop - 150){
            layoutCurrent = i;
        }
        else if (scrollheight >= offsetTop - offsetheight && i == layoutList.length - 1) {
            layoutCurrent = i;
            // console.log(scrollheight+"/"+ (offsetTop - offsetheight) +" ("+ offsetTop +")")
        }
    }

    limit_buttons(layoutCurrent, layoutList, "to-top", "to-bottom")
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////// CONTROLS //////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// INIT

var slideList = []
var currentSlide = 0;

function initcontrols() {
    slidesList = document.getElementById("slides").children
    for (let i = 0; i < slidesList.length; i++) {
        let slideID = 'slide'+ (i+1)
        slidesList.item(i).setAttribute('id', slideID);
        slideList.push(slideID);
    }

    for (let i = 0; i < slideList.length; i++) {

		let slide = document.getElementById(slideList[i])
        let slideIndex = document.getElementById('slideIndex')

        slideIndex.insertAdjacentHTML('beforeend', index_template(slide, i));
    }
    
    displaySlide(currentSlide)

    document.getElementById("controls").addEventListener("mousemove", initautohidecontrols)
    document.querySelectorAll("#slideIndex, #slideCurrent, #letztes, #nächstes").forEach((item) => {item.addEventListener("mouseenter", entercontrols)})
    document.querySelectorAll("#slideIndex, #slideCurrent, #letztes, #nächstes").forEach((item) => {item.addEventListener("mouseleave", leavecontrols)})
}





// SLIDE SELECTION

function displaycurrent() {

    let highlightcurrenttitle = (typeof highlight_title === "function")
    let showcurrenttitle = (typeof index_title_template === "function")
    let overridetitle = (typeof overridetitletext !== "undefined")

    if(highlightcurrenttitle) {
        highlight_title(currentSlide)
    }
    if(showcurrenttitle) {
        document.getElementById("slideCurrentTitle").innerHTML = index_title_template(currentSlide)
    }
    if(overridetitle) {
        document.getElementById("slideCurrent").innerHTML = overridetitletext
    }
    else {
        document.getElementById("slideCurrent").innerHTML = (currentSlide + 1) + "/" + slideList.length
    }

    if(showcurrenttitle||overridetitle) {
        initlanguage() //needed bc it changes DOM
    }

    loadframes()
    limit_buttons(currentSlide, slideList, "letztes", "nächstes")
    reset_scroll()
    pausevideos()
}


function letztesissue() {
    if(currentSlide>=0) {
        document.getElementById(slideList[currentSlide]).style.display = "none";
        currentSlide = currentSlide - 1;
        document.getElementById(slideList[currentSlide]).style.display = "flex";
    }

    displaycurrent()
    timecontrols()
}

function nächstesissue() {
    if(currentSlide<=slideList.length-1) {
        document.getElementById(slideList[currentSlide]).style.display = "none";
        currentSlide = currentSlide + 1;
        document.getElementById(slideList[currentSlide]).style.display = "flex";
    }

    displaycurrent()
    timecontrols()
}

function displaySlide(slideIndex) {
    document.getElementById(slideList[currentSlide]).style.display = "none";
    currentSlide = slideIndex;
    document.getElementById(slideList[currentSlide]).style.display = "flex";

    displaycurrent()
    hideSlideIndex()
}


// SLIDE INDEX

function displaySlideIndex() {
    var indexitems = document.getElementsByClassName("indexitem")
    for (let i = 0; i < indexitems.length; i++) {
        indexitems[i].style.fontWeight = "400"
    }

    document.getElementById("index"+currentSlide).style.fontWeight = "700"
    document.getElementById("slideCurrentTitle").style.display = "none";
    document.getElementById(slideList[currentSlide]).style.display = "none";
    document.getElementById("slideIndex").style.display = "block";
}

function hideSlideIndex() {
    document.getElementById("slideCurrentTitle").style.display = "block";
    document.getElementById("slideIndex").style.display = "none";
    document.getElementById(slideList[currentSlide]).style.display = "flex";
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////// AUTO HIDING CONTROLS //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// CONTROL AUTO HIDING


var oncontrols = false;

function initautohidecontrols() {
    document.addEventListener("mousemove", timecontrols);
    document.getElementById("controls").removeEventListener("mousemove", initautohidecontrols);
}

function hidecontrols() {
    document.getElementById("controls-inner").style.visibility = "hidden";
}

// timer start

function timecontrols() {
    if(autohidecontrols == true && oncontrols == false) {
        document.getElementById("controls-inner").style.visibility = "visible";
        clearTimeout(TIMEOUT_IDS["controls"])
        TIMEOUT_IDS["controls"] = setTimeout(hidecontrols, 8000);
    }
}

function entercontrols() {
    clearTimeout(TIMEOUT_IDS["controls"])
    oncontrols = true;
}

function leavecontrols() {
    timecontrols();
    oncontrols = false;
}






/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////// FUNCTIONALITY /////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////




/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////// FOOTNOTES ///////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// ⁰¹²³⁴⁵⁶⁷⁸⁹⁽⁾
var superscriptList = [
    '⁰',
    '¹',
    '²',
    '³',
    '⁴',
    '⁵',
    '⁶',
    '⁷',
    '⁸',
    '⁹'
]

function tosuperscript(num) {
    num = num.toString()
    nums = num.split('')

    for (let i = 0; i < nums.length; i++){
        nums[i] = superscriptList[nums[i]]
    }

    return nums.join()
}

function initfootnotes() {
    console.log("initfootnotes")
    for (let i = 0; i < footnoteList.length; i++) {

        let footnote = document.getElementById("f"+ (i+1))
        footnote.className = 'footnote';
        footnote.tabIndex = '0'
        footnote.innerHTML = tosuperscript(i+1)
        footnote.addEventListener("mouseenter", selectfootnote)
        footnote.insertAdjacentHTML('beforeend', footnote_template(i));
    }

    if(localStorage.getItem("gefaengnishefte_cookies") != "true"){
        hidecookiecontent();
    }

    document.addEventListener("click", focusfootnote)
    document.getElementById("content").addEventListener("scroll", autosetlayout)
}

function footnote_template(i) {

    let note_info = footnoteList[i]
    let note = tosuperscript(i+1) + ' <span lang="de">' + note_info.text_de + '</span><span lang="en">' + note_info.text_en + '</span>'

    if(note_info.embed_source == "youtube" || note_info.embed_source == "spotify") {
        note = note + '<br><br><iframe class="footnotevideo" src="about:blank" data-source=' + note_info.embed_source + ' data-id=' + note_info.embed_id + ' sandbox></iframe>'
    }
    else if (note_info.embed_url){
        note = note + '<br><br><iframe class="footnotevideo" src="about:blank" sandbox loading="lazy">' + note_info.embed_url + '</iframe>'
    }

    return '<span class="note">' + note + '</span>'
}



var footnotefocused = "none";

function focusfootnote(event) {
    if(event.target.className == "footnote") {
        selectfootnote(event)
    }
    else if(footnotefocused != "none") {
        if(!footnotefocused.contains(event.target)) {
            resetfootnote()
            pausevideos();
        }
    }
}

function selectfootnote(event) {
    closesharewindow()

    if(footnotefocused != "none") {
        resetfootnote()
    }

    footnotefocused = event.target;

    footnotefocused.style.color = "#980000";
    footnotefocused.childNodes[1].style.zIndex = "19";
    footnotefocused.childNodes[1].style.display = "inline";
    loadframe(footnotefocused.getElementsByTagName("iframe"), 0, currentSlide)
}

function resetfootnote() {
    footnotefocused.style.color = "black";
    footnotefocused.childNodes[1].style.zIndex = "0";
    footnotefocused.childNodes[1].style.display = "none";
    footnotefocused = "none";
}




/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////// SHARING ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// SHARE LINK

var copy_link = ""

function initsharewindow() {
    for (let i = 0; i < linkList.length; i++) {
        document.getElementById("link-opt").insertAdjacentHTML('beforeend', share_template(i));
    }

    select_share(0)
}

function share_template(i) {return '<span onclick="select_share(' + i + ')"><span lang="de">' + linkList[i].title_de + '</span><span lang="en">' + linkList[i].title_en + '</span><br></span>'}



function opensharewindow() {
    document.getElementById("sharewindow").style.display = "block"
}

function closesharewindow() {
    document.getElementById("sharewindow").style.display = "none"
}


function select_share(index) {

    let linkopts = document.getElementById("link-opt").children

    for (let i = 0; i < linkopts.length; i++) {
        linkopts.item(i).style.textDecoration = "none"
    }

    linkopts.item(index).style.textDecoration = "underline"
    copy_link = linkList[index].link
}


function copy_share() {

    navigator.clipboard.writeText(copy_link);
    
    let btn = document.getElementById("link-copy-btn")
    let textOriginal = btn.innerHTML
    let textReplace = '<span lang="de">Link kopiert!</span><span lang="en">Copied link!</span>'
    
    btn.innerHTML = textReplace;

    setTimeout(function(){
        btn.innerHTML = textOriginal;
        initlanguage()
    }, 3000);

    initlanguage()
}