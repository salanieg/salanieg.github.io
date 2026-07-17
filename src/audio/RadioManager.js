// ============================================================================
// RadioManager.js — Cockpit-Radio: streamt MP3s (music/<Sender>/) über ein
// HTMLAudioElement in die Web-Audio-Kette des AudioManagers.
//
// KI-LANDKARTE:
//   - Senderliste/Playlists: this.stations (Pfade relativ zur index.html).
//     Neue MP3 hinzufügen = Datei in music/<Sender>/ legen UND hier eintragen.
//   - Bedienlogik (Klick aufs Radio-Display im Führerstand): WorldManager
//     raycastet, main.js animate() wertet sim.wantsRadioPlay/Next/Off aus.
//   - Die Anzeige (Sender + Titel) zeichnet TrainModel.updateRadioDisplay.
// ============================================================================
export class RadioManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.currentStationIdx = 0;
        this.defaultStationIdx = 0; // "Antenne Delta" - what the radio starts on
        this.stations = [
            {
                name: "Antenne Delta",
                path: "music/Antenne Delta/",
                files: ["Pointman Frogs.mp3", "Alpine Breath.mp3", "Drifting Inside.mp3", "River Of Souls.mp3", "Space Aviation.mp3"]
            },
            {
                name: "Classic Radio",
                path: "music/Classic Radio/",
                files: ["Barber Of Seville.mp3", "Wilhelm Tell Ouverture.mp3"]
            },
            {
                name: "Dance Radio",
                path: "music/Dance Radio/",
                files: ["Nimbostratus.mp3", "Stratocumulus.mp3"]
            },
            {
                name: "West Radio",
                path: "music/West Radio/",
                files: ["On The Honky Tonks.mp3", "Rock With Slide.mp3", "Train Country Blues.mp3"]
            },
            {
                name: "World Radio",
                path: "music/World Radio/",
                files: ["Africa We Want To Go.mp3", "Everyday Is A Holiday.mp3", "Love Of My Life.mp3"]
            }
        ];

        this.gainNode = null;
        this.isPlaying = false;
        this.currentFileIdx = 0;

        // Streaming über HTMLAudioElement (statt vollständigem Buffer-Download)
        this.audioElement = new Audio();
        this.audioElement.crossOrigin = "anonymous";
        this.sourceNode = null;

        // Set by nextStation()/prevStation(): on the next play() for a freshly
        // zapped-to track, seek to a random point once its duration is known,
        // so switching stations "zaps in" mid-song like a real radio scan.
        this._seekRandomOnLoad = false;
    }

    init() {
        if (!this.audioManager.initialized) return;
        this.gainNode = this.audioManager.ctx.createGain();
        this.gainNode.connect(this.audioManager.masterVolume);

        // Connect HTMLAudioElement to Web Audio API
        this.sourceNode = this.audioManager.ctx.createMediaElementSource(this.audioElement);
        this.sourceNode.connect(this.gainNode);

        // Handle sequential playback
        this.audioElement.onended = () => {
            if (this.isPlaying) {
                this.currentFileIdx++;
                this.play(this.currentStationIdx);
            }
        };
    }

    play(stationIdx = this.currentStationIdx) {
        if (!this.audioManager.initialized) return;
        if (!this.gainNode) this.init();

        this.currentStationIdx = stationIdx;
        this.isPlaying = true;

        const station = this.stations[this.currentStationIdx];
        const file = station.files[this.currentFileIdx % station.files.length];
        const url = station.path + file;

        // Update source and play (streaming starts immediately)
        if (this.audioElement.src !== window.location.origin + "/" + url &&
            !this.audioElement.src.endsWith(url)) {
            this.audioElement.src = url;
            this.audioElement.load();

            if (this._seekRandomOnLoad) {
                this._seekRandomOnLoad = false;
                const seekToRandomPoint = () => {
                    const dur = this.audioElement.duration;
                    // Land somewhere in the middle of the track (10%-70%), never right at
                    // the start (wouldn't look "zapped in") or right at the end (would
                    // immediately trigger onended and skip to the next track).
                    if (isFinite(dur) && dur > 5) {
                        this.audioElement.currentTime = dur * (0.1 + Math.random() * 0.6);
                    }
                };
                this.audioElement.addEventListener('loadedmetadata', seekToRandomPoint, { once: true });
            }
        }

        this.audioElement.play().catch(e => console.error("Radio playback error:", e));
    }

    stop() {
        this.isPlaying = false;
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        // Optionally clear src to stop background buffering
        this.audioElement.removeAttribute('src');
        this.audioElement.load();
    }

    nextStation() {
        this.currentStationIdx = (this.currentStationIdx + 1) % this.stations.length;
        this.zapToRandomTrack();
        return this.currentStationIdx;
    }

    prevStation() {
        this.currentStationIdx = (this.currentStationIdx - 1 + this.stations.length) % this.stations.length;
        this.zapToRandomTrack();
        return this.currentStationIdx;
    }

    // Jump to a random song of the new station, at a random point in the track,
    // instead of always restarting the station's playlist from track 1 / 0:00.
    zapToRandomTrack() {
        const station = this.stations[this.currentStationIdx];
        this.currentFileIdx = Math.floor(Math.random() * station.files.length);
        this._seekRandomOnLoad = true;
        this.play();
    }

    // Used whenever the radio is (re-)switched on: always starts on the default
    // station with the first track (Pointman Frogs) from the very beginning.
    startDefaultStation() {
        this.currentStationIdx = this.defaultStationIdx;
        this.currentFileIdx = 0;       // always "Pointman Frogs"
        this._seekRandomOnLoad = false; // play from the start, not a random point
        this.play();
    }

    getStationName() {
        return this.stations[this.currentStationIdx].name;
    }

    getCurrentSongName() {
        const station = this.stations[this.currentStationIdx];
        const file = station.files[this.currentFileIdx % station.files.length];
        return file.replace(/\.[^/.]+$/, ''); // strip the file extension
    }
}
