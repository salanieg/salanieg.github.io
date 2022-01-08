import Head from 'next/head'
import Header from '@components/Header'
import Footer from '@components/Footer'

export default function Home() {
  return (
    <div className="container">
      <Head>
        <title>ISSUES</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
      <a href="https://sites.google.com/view/gefaengnishefte/issues">ISSUES</a>
      </main>

      <Footer />
    </div>
  )
}
