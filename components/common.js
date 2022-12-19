/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////// GENERAL ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// COMPONENT LOADING

function fetchHTML(url, id) {
	fetch(url)
	.then(response => response.text())
	.then(value => {
		document.getElementById(id).innerHTML = value
	});
}


// HEIGHTFIX

let vh = window.innerHeight * 0.01;
document.documentElement.style.setProperty('--vh', `${vh}px`);

window.addEventListener('resize', () => {
	let vh = window.innerHeight * 0.01;
	document.documentElement.style.setProperty('--vh', `${vh}px`);
});


// CUSTOM SCROLLBAR

var timeoutid;

function hidescrollbar() {
	document.documentElement.style.setProperty('--scrollbar-color', 'transparent');
}

function customizescrollbar() {
	document.documentElement.style.setProperty('--scrollbar-color', getComputedStyle(document.documentElement).getPropertyValue('--default-scrollbar-color'));
	clearTimeout(timeoutid)
	timeoutid = setTimeout(hidescrollbar, 3000);
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////// LANGUAGE ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


function initlanguage() {
	if(localStorage.getItem("gefaengnishefte_language") != "de" && localStorage.getItem("gefaengnishefte_language") != "en") {
		localStorage.setItem("gefaengnishefte_language", "de");
	}

	setlanguage(localStorage.getItem("gefaengnishefte_language"))
	// FIX!!!
	sethighlights()
	window.addEventListener("resize", openmenufix)
	document.addEventListener("DOMContentLoaded", sethighlights);
	document.getElementById("content").addEventListener("scroll", customizescrollbar);
	document.getElementById("email-form").addEventListener('submit', function(event){submitemail(event)})
	document.getElementById("email-form").addEventListener('input', function(event){inputemail(event)})
}

function setlanguage(language) {

	// // CHECK!!!
	document.querySelectorAll('[lang="de"]').forEach((item) => {item.hidden = true;})
	document.querySelectorAll('[lang="en"]').forEach((item) => {item.hidden = true;})
	document.getElementById("lang-de").style.textDecoration = "none"
	document.getElementById("lang-en").style.textDecoration = "none"
	document.getElementById("lang-" + language).style.textDecoration = "underline"
	document.querySelectorAll('*:lang(' + language + '):not(br)').forEach((item) => {item.hidden = false;})

	localStorage.setItem("gefaengnishefte_language", language);	
}



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

var highlights = [
				["", "dropanchori"],
				["/", "dropanchori"],
				["/issue-i", "dropanchori"],
				["/issue-i", "info-issue-i"],
				["/kanon", "dropanchork"],

				["", "descriptioni"],
				["/", "descriptioni"],
				["/issue-i", "descriptioni"],
				["/issue-i", "descriptionisi"],
				["/kanon", "descriptionk"],

				["/deabonnieren", "etc"],
				["/deabonnieren", "descriptiond"],

				["/impressum", "etc"],
				["/impressum", "descriptionim"],

				["/datenschutz", "etc"],
				["/datenschutz", "descriptionda"]
];

function sethighlights() {
	for (var i = 0; i < highlights.length; i++ ) {

		var pair = highlights[i]
	
		if (window.location.href.toLowerCase() == ("https://www.GEFAENGNISHEFTE.org" + pair[0]).toLowerCase()) {
			document.getElementById(pair[1]).style.fontWeight = "700";
		}
	}
}




/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////// ABO //////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// ABONNIEREN

var emailinfodisabled = false;

// NEEDS FIXING!!!!!!!!!!!!!!!!!!!!!

function submitemail(event) {
	event.preventDefault()

	// $.ajax({
	// 	method: 'POST',
	// 	url: 'https://formsubmit.co/ajax/6d2bd15bcc3410a47e44b78943d390d0',
	// 	dataType: 'json',
	// 	accepts: 'application/json',
	// 	data: $(event.target).serialize() + "&Code=" + makeid(40)
	// 	,
	// 	success: (data) => console.log("submitted"),
	// 	error: (err) => alert(err)
	// });
	
	fetch("https://formsubmit.co/ajax/6d2bd15bcc3410a47e44b78943d390d0", {
		method: "POST",
		headers: { 
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		},
		body: JSON.stringify({
			name: "FormSubmit",
			message: "I'm from Devro LABS"
		})
	})
	// data: $(event.target).serialize() + "&Code=" + makeid(40)
	.then(response => response.json())
	.then(data => console.log(data))
	.catch(error => console.log(error));

	document.getElementById("email-btn").innerHTML = '<span lang="de">Abonniert!</span><span lang="en">Subscribed!</span>';
	document.getElementById("email-btn").disabled = true;
	document.getElementById("email-info").style.display = "none";
	document.getElementById("email-checkbox").checked = false;
	emailinfodisabled = true;
	initlanguage() //needed bc it changes DOM
}

function inputemail(event) {
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

function initsetabo() {
	if(localStorage.getItem("gefaengnishefte_abo") != "email" && localStorage.getItem("gefaengnishefte_abo") != "telegram") {
		localStorage.setItem("gefaengnishefte_abo", "email");
	}

	setabo(localStorage.getItem("gefaengnishefte_abo"))
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


// INIT

function initfooter() {
    resetverticalbuttons()
    initfootnotes()
}

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
    for (let i = 1; i < footnoteList.length + 1; i++) {
        let number = tosuperscript(i)

        let footnote = document.getElementById("f"+i)
        footnote.className = 'footnote';
        footnote.tabIndex = '0'
        footnote.innerHTML = number;
        footnote.addEventListener("mouseenter", selectfootnote)

        let note = document.createElement('span');
        note.className = 'note';
        note.innerHTML = number + " " + footnoteList[(i-1)];

        footnote.appendChild(note)
    }

    console.log("initfootnotes catch")
    console.log(localStorage.getItem("gefaengnishefte_cookies"))
    // catch footnotes loading after databanner
    if(localStorage.getItem("gefaengnishefte_cookies") != "true" && typeof hidecookiecontent === "function"){
        console.log("initfootnotes hidecookiecontent")
        hidecookiecontent();
    }

    document.addEventListener("click", focusfootnote)
    document.getElementById("content").addEventListener("scroll", autosetlayout)
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

    if(footnotefocused != "none") {
        resetfootnote()
    }

    footnotefocused = event.target;

    footnotefocused.style.color = "#980000";
    footnotefocused.childNodes[1].style.zIndex = "19";
    footnotefocused.childNodes[1].style.display = "inline";
    loadframe(footnotefocused.getElementsByTagName("iframe"), 0)
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

var textOriginal;
const textList = [];
var textIndex = 0;

function copyanchor(anchor, id, textReplace) {
    navigator.clipboard.writeText('https://www.gefaengnishefte.org/issue-i' + id);
    var text = anchor.innerHTML
    if (text != textReplace){
        textOriginal = text;
        textList.push(textOriginal)
    
        anchor.innerHTML = textReplace;
        setTimeout(function(){
            anchor.innerHTML = textList[textIndex];
            textIndex = textIndex + 1;
            initlanguage()
        }, 3000);
    }
    initlanguage()
}

// SHARE LINK

function opensharewindow() {
    document.getElementById("sharewindow").style.display = "block"
}

function closesharewindow() {
    document.getElementById("sharewindow").style.display = "none"
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


// VIDEO PAUSER

function pausevideos() {
	var frames = document.getElementsByTagName("iframe")

	for (let i = 0; i < frames.length; i++)
	{
		frames[i].contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
	}
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////// INIT /////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


var slideList = []

function initcontrols() {
    slidesList = document.getElementById("slides").children
    for (let i = 0; i < slidesList.length; i++) {
        let slideID = 'slide'+ (i+1)
        slidesList.item(i).setAttribute('id', slideID);
        slideList.push(slideID);
    }

    for (let i = 0; i < slideList.length; i++) {
        if(useindexlist) {
            document.getElementById('slideIndex').append('<span id="index' + i + '" class="indexitem" onclick="displayBySlideIndex(' + i + ')">' + indexList[i] + '</span><br>');
        }
        else {
            let titleDE = document.getElementById(slideList[i]).getAttribute('data-title-de')
            let titleEN = document.getElementById(slideList[i]).getAttribute('data-title-en')
            
            let newbreak = document.createElement("br")
            let newindex = document.createElement("span")
            newindex.id = "index" + i
            newindex.className = "indexitem"
            newindex.innerHTML = "<span lang='de'>" + titleDE + "</span><span lang='en'>" + titleEN + "</span>"
            newindex.onclick = function(){displayBySlideIndex(i)}

            document.getElementById('slideIndex').append(newindex)
            document.getElementById('slideIndex').append(newbreak)
        }
        
    }
    
    displayBySlideIndex(slideSelected)
    resetcontrols()
    displaycurrent()
    keeptop()

    document.getElementById("slideIndex").addEventListener("scroll", resetscrollbarindex)
    
    document.getElementById("controls").addEventListener("mousemove", initautohidecontrols);


    document.getElementById("slideIndex").addEventListener("mouseenter", entercontrols)
    document.getElementById("letztes").addEventListener("mouseenter", entercontrols)
    document.getElementById("slideCurrent").addEventListener("mouseenter", entercontrols)
    document.getElementById("nächstes").addEventListener("mouseenter", entercontrols)
    
    document.getElementById("slideIndex").addEventListener("mouseleave", leavecontrols)
    document.getElementById("letztes").addEventListener("mouseleave", leavecontrols)
    document.getElementById("slideCurrent").addEventListener("mouseleave", leavecontrols)
    document.getElementById("nächstes").addEventListener("mouseleave", leavecontrols)



    controlsinit = true
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////// VERTICAL NAVIGATION ///////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


var layoutList = ["info-wrapper", "posthistorische-klassenkaempfe", "der-neue-rahmen", "agieren-und-agitieren"]
var layoutCurrent = 0

function resetverticalbuttons() {
    
    if (layoutCurrent==0) {
        document.getElementById("to-top").disabled = true;
        document.getElementById("to-top").style.color = "lightgrey";
    }
    else {
        document.getElementById("to-top").disabled = false;
        document.getElementById("to-top").style.color = "white";
    }
    
    if (layoutCurrent==layoutList.length-1) {
        document.getElementById("to-bottom").disabled = true;
        document.getElementById("to-bottom").style.color = "lightgrey";
    }
    else {
        document.getElementById("to-bottom").disabled = false;
        document.getElementById("to-bottom").style.color = "white";
    }
}

function verticalup() {

    if(layoutCurrent > 0) {
        layoutCurrent = layoutCurrent - 1
        document.getElementById(layoutList[layoutCurrent]).scrollIntoView()
        resetverticalbuttons()
    }
}

function verticaldown() {

    if(layoutCurrent < layoutList.length - 1) {
        layoutCurrent = layoutCurrent + 1
        document.getElementById(layoutList[layoutCurrent]).scrollIntoView()
        resetverticalbuttons()
    }
}


function autosetlayout() {
    var scrollheight = document.getElementById("content").scrollTop
    layoutCurrent = 0;
    for (let i = 0; i < layoutList.length; i++) {
        if(scrollheight >=document.getElementById(layoutList[i]).offsetTop - 150){
            layoutCurrent = i;
        }
    }

    resetverticalbuttons()
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////// SLIDE SELECTION ////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// SLIDE SELECTION

function displaycurrent() {
    if(showcurrenttitle) {
        document.getElementById("slideCurrentTitle").innerHTML = titleList[slideSelected]
    }
    if(overridetitle) {
        document.getElementById("slideCurrent").innerHTML = overridetitletext
    }
    else {
        document.getElementById("slideCurrent").innerHTML = (slideSelected + 1) + "/" + slideList.length
    }

    if(showcurrenttitle||overridetitle) {
        initlanguage() //needed bc it changes DOM
    }
}

function loadframes() {
    loadframe(document.getElementById(slideList[slideSelected]).getElementsByTagName("iframe"), 0)
}


function letztesissue() {
    if(slideSelected>=0) {
        document.getElementById(slideList[slideSelected]).style.display = "none";
        slideSelected = slideSelected - 1;
        document.getElementById(slideList[slideSelected]).style.display = "flex";
    }

    loadframes()
    resetcontrols();
    displaycurrent();
    keeptop();
    timecontrols();
    pausevideos();
}

function nächstesissue() {
    if(slideSelected<=slideList.length-1) {
        document.getElementById(slideList[slideSelected]).style.display = "none";
        slideSelected = slideSelected + 1;
        document.getElementById(slideList[slideSelected]).style.display = "flex";
    }

    loadframes()
    resetcontrols();
    displaycurrent();
    keeptop();
    timecontrols();
    pausevideos();
}

function displayBySlideIndex(slideIndex) {
    document.getElementById(slideList[slideSelected]).style.display = "none";
    slideSelected = slideIndex;
    document.getElementById(slideList[slideSelected]).style.display = "flex";

    loadframes()
    resetcontrols();
    displaycurrent();
    hideSlideIndex();
    keeptop();
    pausevideos();
}


// SLIDE INDEX

function displaySlideIndex() {
    var indexitems = document.getElementsByClassName("indexitem")
    for (let i = 0; i < indexitems.length; i++) {
        indexitems[i].style.fontWeight = "300"
    }

    document.getElementById("index"+slideSelected).style.fontWeight = "700"
    document.getElementById("slideCurrentTitle").style.display = "none";
    document.getElementById(slideList[slideSelected]).style.display = "none";
    document.getElementById("slideIndex").style.display = "block";
}

function hideSlideIndex() {
    document.getElementById("slideCurrentTitle").style.display = "block";
    document.getElementById("slideIndex").style.display = "none";
    document.getElementById(slideList[slideSelected]).style.display = "flex";
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////// VISUAL TWEAKS /////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


var timeoutIDindex;
var timeoutIDcontrols;
var oncontrols = false;


// SCROLLBAR

function hidescrollbarindex() {
    document.documentElement.style.setProperty('--scrollbar-color-index', 'transparent');
}

function resetscrollbarindex() {
    document.documentElement.style.setProperty('--scrollbar-color-index', getComputedStyle(document.documentElement).getPropertyValue('--default-scrollbar-color-index'));
    clearTimeout(timeoutIDindex)
    timeoutIDindex = setTimeout(hidescrollbarindex, 10000);
}

function keeptop() {
    document.getElementById("content").scrollTop = 0;
    document.documentElement.scrollTop = 0;
    if(typeof hidescrollbar === "function"){
        setTimeout(hidescrollbar, 1);
    }
}


// CONTROL AUTO HIDING

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
        clearTimeout(timeoutIDcontrols)
        timeoutIDcontrols = setTimeout(hidecontrols, 8000);
    }
}

function entercontrols() {
    clearTimeout(timeoutIDcontrols)
    oncontrols = true;
}

function leavecontrols() {
    timecontrols();
    oncontrols = false;
}


// CONTROL DISABLEING

function resetcontrols() {
    if (slideSelected==0) {
        document.getElementById("letztes").disabled = true;
        document.getElementById("letztes").style.color = "lightgrey";
    }
    else {
        document.getElementById("letztes").disabled = false;
        document.getElementById("letztes").style.color = "white";
    }
    
    if (slideSelected==slideList.length-1) {
        document.getElementById("nächstes").disabled = true;
        document.getElementById("nächstes").style.color = "lightgrey";
    }
    else {
        document.getElementById("nächstes").disabled = false;
        document.getElementById("nächstes").style.color = "white";
    }
}