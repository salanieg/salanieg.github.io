
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

    document.getElementById("content").addEventListener("scroll", autosetlayout)
}

document.addEventListener("click", focusfootnote)
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
    loadframe(document.getElementById(footnotefocused).getElementsByTagName("iframe"), 0)
}

function resetfootnote() {
    footnotefocused.style.color = "black";
    footnotefocused.childNodes[1].style.zIndex = "0";
    footnotefocused.childNodes[1].style.display = "none";
    footnotefocused = "none";
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////// NAVIGATION ///////////////////////////////////////////////////
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