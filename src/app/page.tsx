import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>
          RapBeasts <span className={styles.logoAccent}>Studio</span>
        </span>
        <span className={styles.badge}>Em breve</span>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>
            Crie seu beat.
            <br />
            <span className={styles.titleAccent}>Domine a batalha.</span>
          </h1>
          <p className={styles.subtitle}>
            Em breve você vai criar beats e escrever suas barras direto no
            navegador — e levar seu chart para dentro do jogo.
          </p>
          <button className={styles.cta} disabled type="button">
            Criar beat — em breve
          </button>
        </section>

        <section className={styles.steps} aria-label="Como vai funcionar">
          <article className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              🎛️
            </span>
            <h2 className={styles.cardTitle}>Crie seu beat</h2>
            <p className={styles.cardText}>
              Defina o BPM, monte o sequenciador e carregue o áudio da sua
              faixa.
            </p>
          </article>

          <article className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              ✍️
            </span>
            <h2 className={styles.cardTitle}>Escreva suas barras</h2>
            <p className={styles.cardText}>
              Marque o tempo de cada palavra e alinhe seus versos com a
              batida.
            </p>
          </article>

          <article className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              🎮
            </span>
            <h2 className={styles.cardTitle}>Exporte pro jogo</h2>
            <p className={styles.cardText}>
              Gere o Song Package v3 e batalhe no RapBeasts com seu chart.
            </p>
          </article>
        </section>
      </main>

      <footer className={styles.footer}>
        <p className={styles.footerText}>
          RapBeasts Studio © {new Date().getFullYear()}
        </p>
        <a className={styles.adminLink} href="/admin">
          Admin (localhost)
        </a>
      </footer>
    </div>
  );
}
