import { NOTICE_SHORT, NOTICE_VERSION } from "../../../../shared/research/notice";

type Props = {
  ageOver15: boolean;
  noticeAccepted: boolean;
  retainProfile: boolean;
  serviceImprovement: boolean;
  onChange: (patch: {
    ageOver15?: boolean;
    noticeAccepted?: boolean;
    retainProfile?: boolean;
    serviceImprovement?: boolean;
  }) => void;
  onContinue: () => void;
  goPrivacy: () => void;
};

export default function TopicNotice({
  ageOver15,
  noticeAccepted,
  retainProfile,
  serviceImprovement,
  onChange,
  onContinue,
  goPrivacy,
}: Props) {
  const canContinue = ageOver15 && noticeAccepted;

  return (
    <section className="topic-notice topic-phase">
      <div className="topic-section-head topic-notice-head">
        <h2>Avant de commencer</h2>
        <p className="topic-notice-lead">
          Suggestions méthodologiques uniquement : aucune décision automatisée
          à votre égard.
        </p>
      </div>

      <div className="topic-notice-layout">
        <details className="topic-notice-box">
          <summary>
            Notice d’information (art. 13)
            <span className="topic-notice-version">{NOTICE_VERSION}</span>
          </summary>
          <div className="topic-notice-body">
            <p>{NOTICE_SHORT}</p>
            <button type="button" className="textbtn" onClick={goPrivacy}>
              Politique de confidentialité complète
            </button>
          </div>
        </details>

        <div className="topic-consents-card">
          <div className="topic-consents-group">
            <p className="topic-consents-label">Obligatoire</p>
            <label className="topic-consent required">
              <input
                type="checkbox"
                checked={ageOver15}
                onChange={(e) => onChange({ ageOver15: e.target.checked })}
              />
              <span>J’ai 15 ans ou plus</span>
            </label>
            {!ageOver15 && (
              <p className="topic-help">
                Parcours réservé aux personnes de 15 ans ou plus.
              </p>
            )}
            <label className="topic-consent required">
              <input
                type="checkbox"
                checked={noticeAccepted}
                onChange={(e) =>
                  onChange({ noticeAccepted: e.target.checked })
                }
              />
              <span>
                J’ai lu la notice et je souhaite utiliser ce service.
              </span>
            </label>
          </div>

          <div className="topic-consents-group">
            <p className="topic-consents-label">Facultatif</p>
            <label className="topic-consent">
              <input
                type="checkbox"
                checked={retainProfile}
                onChange={(e) => onChange({ retainProfile: e.target.checked })}
              />
              <span>
                Conserver mon profil pour y revenir (serveur à venir)
              </span>
            </label>
            <label className="topic-consent">
              <input
                type="checkbox"
                checked={serviceImprovement}
                onChange={(e) =>
                  onChange({ serviceImprovement: e.target.checked })
                }
              />
              <span>
                Autoriser l’amélioration anonymisée du service
              </span>
            </label>
          </div>
        </div>

        <div className="topic-nav topic-notice-nav">
          <button
            type="button"
            className="primary"
            disabled={!canContinue}
            onClick={onContinue}
          >
            Commencer le questionnaire
            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
