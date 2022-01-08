import Head from 'next/head'
import Header from '@components/Header'
import Footer from '@components/Footer'

export default function Home() {
  return (
    <div className="container">
      <Head>
        <title>Next.js Starter!</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <Header title="Welcome to my app!" />
    
        <style>

        @import url('https://fonts.googleapis.com/css?family=Spectral');
        a:hover, a:visited, a:link, a:active
        {
            text-decoration: none;
        }
        .cover {position: absolute;}
        .inhalt {
        padding-top: 10%;
        padding-left: 10%;
        padding-right: 15%;
        font-family:'Spectral';
        font-size: 13pt;
        color: white;
        text-decoration: none;
        z-index: 10;}
        .title {
        font-size: 15pt;
        text-decoration: underline;
        font-weight: bold;
        }

        #issue:hover .cover {opacity:0;transition: opacity 1s ease;}
        #issue:hover .inhalt {opacity:1;transition: opacity 1s ease;}

        #issue .cover {opacity:1;transition: opacity 1s ease;}
        #issue .inhalt {opacity:0;transition: opacity 1s ease;}
        </style>



        <div id="issue">

        <a href="https://sites.google.com/view/gefaengnishefte/issues/issue-i" target="_blank">
        <img 
        src="https://drive.google.com/uc?export=view&id=14OQJ7ZAzti5Yepbm-C-8J8aF9fvzVcuX"
        class="cover"
        style="width:95%; height:auto;"
        alt="ISSUE I">

        <div class="inhalt">
        <span class="title">Der neue Rahmen</span><br><br>

        Wenn der Liberalismus in gewisse Rahmenbedingungen eingebettet wird, kann so soziale und ökologische Nachhaltigkeit sichergestellt werden. Gleichzeitig profitiert ein solches System von der schnellen Anpassungsfähigkeit eines freien, Anreizorientierten Marktes. Durch diese Geschwindigkeit kann die Sicherung der Bedürfnisse der Menschen am besten sichergestellt werden.


        <br><br><br><span class="title">Posthistorische Klassenkämpfe</span><br><br>

        Der Kapitalismus ist weder alternativlos, noch kann er durch einfache Reformen zu sozialer und ökologischer Nachhaltigkeit korrigiert werden. Er ist ein System von herrschenden Klassen, für eben diese herrschenden Klassen. Wohin aber, wenn der Gegenversuch des Staatskommunismus gescheitert ist?


        <br><br><br><span class="title">Agieren & Agitieren.</span><br><br>

        Wie baut man eine beständige emanzipatorische Bewegung auf, die nicht in ohnmächtigen Utopismus verfällt, während sie alltägliches Leid hinnimmt? Es ist notwendig, die erkämpften Fortschritte gegen Angriffe zu verteidigen. Dabei jedoch nicht den Weg der Sozialdemokratie zu gehen, sich dem bestehenden System zu fügen und zur Verschleierung von Herrschaftsverhältnissen beizutragen ist die Herausforderung.
        </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
