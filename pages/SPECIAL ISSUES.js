import Head from 'next/head'
import Header from '@components/Header'
import Footer from '@components/Footer'

export default function Home() {
  return (
    <div className="container">
      <Head>
        <title>SPECIAL ISSUES</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
      <a href="https://gefaengnishefte.netlify.app/">ISSUES</a>
      </main>

      <Footer />
    </div>
  )
}
