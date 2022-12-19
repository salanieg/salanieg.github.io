/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////// GENERAL ////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var getURL = function (url, success, error) {
	if (!window.XMLHttpRequest) return;
	var request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState === 4) {
			if (request.status !== 200) {
				if (error && typeof error === 'function') {
					error(request.responseText, request);
				}
				return;
			}
			if (success && typeof success === 'function') {
				success(request.responseText, request);
			}
		}
	};
	request.open('GET', url);
	request.send();
};

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


// LANGUAGE

function initlanguage() {
	if(localStorage.getItem("gefaengnishefte_language") != "de" && localStorage.getItem("gefaengnishefte_language") != "en") {
		localStorage.setItem("gefaengnishefte_language", "de");
	}

	setlanguage(localStorage.getItem("gefaengnishefte_language"))
	// FIX!!!
	document.getElementById("content").addEventListener("scroll", customizescrollbar);
	document.getElementById("email-form").addEventListener('submit', function(event){submitemail(event)})
	document.getElementById("email-form").addEventListener('input', function(event){inputemail(event)})
}

function setlanguage(language) {

	// CHECK!!!
	document.querySelectorAll('[lang="de"]').forEach((item) => {item.style.display = 'none';})
	document.querySelectorAll('[lang="en"]').forEach((item) => {item.style.display = 'none';})
	document.getElementById("lang-de").style.textDecoration = "none"
	document.getElementById("lang-en").style.textDecoration = "none"
	document.getElementById("lang-" + language).style.textDecoration = "underline"
	document.querySelectorAll('*:lang(' + language + '):not(br)').forEach((item) => {item.style.display = 'initial';})

	localStorage.setItem("gefaengnishefte_language", language);	
}


// VIDEO PAUSER

function pausevideos() {
	var frames = document.getElementsByTagName("iframe")

	for (let i = 0; i < frames.length; i++)
	{
		frames[i].contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
	}
}


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
///////////////////////////////////////////////////// MENUS /////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// DROPMENU

var menuopen = false;
var windowwidth = window.innerWidth;

window.addEventListener("resize", (event) => {
	
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
});

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

for ( var i = 0; i < highlights.length; i++ ) {

	var pair = highlights[i]

	if (window.location.href.toLowerCase() == ("https://www.GEFAENGNISHEFTE.org" + pair[0]).toLowerCase()) {
		document.getElementById(pair[1]).style.fontWeight = "700";
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