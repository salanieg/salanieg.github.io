export class RadioManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.currentStationIdx = 0;
        this.stations = [
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

        this.currentSource = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.currentFileIdx = 0;

        // New streaming implementation using HTMLAudioElement
        this.audioElement = new Audio();
        this.audioElement.crossOrigin = "anonymous";
        this.sourceNode = null;
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
        this.currentFileIdx = 0;
        this.play();
        return this.currentStationIdx;
    }

    prevStation() {
        this.currentStationIdx = (this.currentStationIdx - 1 + this.stations.length) % this.stations.length;
        this.currentFileIdx = 0;
        this.play();
        return this.currentStationIdx;
    }

    getStationName() {
        return this.stations[this.currentStationIdx].name;
    }
}
