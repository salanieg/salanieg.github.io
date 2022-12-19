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
            
            document.getElementById('slideIndex').append('<span id="index' + i + '" class="indexitem" onclick="displayBySlideIndex(' + i + ')">' + "<span lang='de'>" + titleDE + "</span><span lang='en'>" + titleEN + "</span>" + '</span><br>');
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