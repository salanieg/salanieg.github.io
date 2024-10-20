function switchLanguage() {
    var deContent = document.getElementById("content-de");
    var enContent = document.getElementById("content-en");

    if (deContent.style.display === "none") {
        deContent.style.display = "block";
        enContent.style.display = "none";
    } else {
        deContent.style.display = "none";
        enContent.style.display = "block";
    }
}