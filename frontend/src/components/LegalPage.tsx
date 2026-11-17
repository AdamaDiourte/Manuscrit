export type LegalPageId =
  | "Contact"
  | "CGV"
  | "RGPD"
  | "Politique de confidentialité";

const pages: Record<LegalPageId, { lead: string; sections: [string, string][] }> =
  {
    Contact: {
      lead:
        "Pour toute question relative à Manuscrit ou à l’accompagnement DataSensia, vous pouvez nous écrire.",
      sections: [
        [
          "Coordonnées",
          "DataSensia — Espace d’accompagnement à la recherche.\nCourriel : contact@datasensia.fr",
        ],
        [
          "Objet des demandes",
          "Support technique, questions sur l’abonnement, demandes d’accès, de rectification ou de suppression de données personnelles.",
        ],
      ],
    },
    CGV: {
      lead:
        "Conditions générales de vente applicables aux services Manuscrit proposés par DataSensia.",
      sections: [
        [
          "Objet",
          "Les présentes conditions définissent les modalités d’accès et d’utilisation de la plateforme Manuscrit, outil d’accompagnement à la rédaction de travaux de recherche.",
        ],
        [
          "Services",
          "Manuscrit permet d’organiser un projet de recherche, de déposer des matériaux et d’obtenir des propositions d’aide à la rédaction. L’utilisateur demeure seul responsable du contenu scientifique produit.",
        ],
        [
          "Abonnement",
          "L’accès à certaines fonctionnalités peut être soumis à un abonnement. Les tarifs, la durée et les modalités de renouvellement sont indiqués au moment de la souscription.",
        ],
        [
          "Responsabilité",
          "DataSensia ne se substitue pas à l’auteur. Les propositions générées constituent des aides méthodologiques à discuter, vérifier et reformuler.",
        ],
      ],
    },
    RGPD: {
      lead:
        "Informations relatives au traitement des données personnelles conformément au Règlement général sur la protection des données (RGPD).",
      sections: [
        [
          "Responsable du traitement",
          "DataSensia est responsable du traitement des données collectées dans le cadre de l’utilisation de Manuscrit.",
        ],
        [
          "Données concernées",
          "Compte utilisateur, contenus de projet déposés, métadonnées d’usage nécessaires au fonctionnement du service, et données de facturation le cas échéant.",
        ],
        [
          "Finalités",
          "Fourniture du service, sécurisation de l’espace de travail, amélioration de l’accompagnement, et respect des obligations légales.",
        ],
        [
          "Droits des personnes",
          "Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité. Pour les exercer : contact@datasensia.fr.",
        ],
      ],
    },
    "Politique de confidentialité": {
      lead:
        "Cette politique décrit la manière dont Manuscrit collecte, utilise et protège vos informations.",
      sections: [
        [
          "Collecte",
          "Nous collectons uniquement les informations nécessaires au fonctionnement du service : identification du compte, contenus que vous déposez, et données techniques de connexion.",
        ],
        [
          "Usage",
          "Ces informations servent à fournir l’espace de travail, à sécuriser les dépôts et, lorsque vous y consentez, à produire des analyses d’aide à la recherche.",
        ],
        [
          "Conservation",
          "Les données sont conservées pendant la durée nécessaire à la fourniture du service et aux obligations légales applicables, puis supprimées ou anonymisées.",
        ],
        [
          "Partage",
          "Les contenus ne sont pas vendus. Des prestataires techniques peuvent intervenir uniquement pour l’hébergement ou le traitement demandé, dans un cadre contractuel approprié.",
        ],
      ],
    },
  };

export default function LegalPage({ page }: { page: LegalPageId }) {
  const content = pages[page];
  return (
    <section className="legal-page">
      <p className="legal-lead">{content.lead}</p>
      {content.sections.map(([title, text]) => (
        <article key={title} className="legal-block">
          <h2>{title}</h2>
          {text.split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
        </article>
      ))}
    </section>
  );
}

export const legalPages: LegalPageId[] = [
  "Contact",
  "CGV",
  "RGPD",
  "Politique de confidentialité",
];

export const isLegalPage = (v: string): v is LegalPageId =>
  legalPages.includes(v as LegalPageId);
