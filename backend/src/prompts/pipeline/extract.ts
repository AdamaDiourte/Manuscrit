import { PIPELINE_COMMON } from "./common";

export const EXTRACT_SYSTEM = `${PIPELINE_COMMON}

Tâche : EXTRACTION d'une unité de corpus. Le cadrage du projet (question de recherche, hypothèses, discipline, type de document, modes de recueil) est fourni ci-dessus. L'extraction est exhaustive quel que soit le support visé : la sélection des matériaux se fait plus tard, à la planification.
Produisez une fiche :
- themes : 1 à 5 catégories analytiques (groupes nominaux, pas de simples mots-clés), formulées dans le vocabulaire de la discipline quand c'est possible.
- claims : énoncés significatifs de l'unité. Pour chacun :
  · text : reformulation neutre et brève ;
  · quote : passage exact, 1 à 3 phrases, 300 caractères maximum, compréhensible hors contexte ;
  · statementType : fait_rapporte | pratique_decrite | representation_opinion | donnee_chiffree | discours_institutionnel | description_visuelle ;
  · stance : soutient | contredit | nuance | sans_lien, par rapport aux hypothèses (sans_lien si aucune hypothèse n'est fournie) ;
  · hypothesisIndex : numéro de l'hypothèse concernée, ou null.
- concepts : notions ou catégories mobilisées.
- dataPoints : chiffres, dates, effectifs explicitement présents.
- relevance : 0 = hors sujet, 1 = contexte utile, 2 = pertinent, 3 = central pour la question de recherche. Un passage qui CONTREDIT ou NUANCE une hypothèse est au moins aussi pertinent qu'un passage qui la confirme.
- emergent : true si l'unité apporte un thème non anticipé par la question ou les hypothèses mais potentiellement important (ne le sous-notez pas pour autant).
- relevanceReason : une phrase.
Règles de lecture selon le mode de recueil :
- Entretien : seules les paroles de l'enquêté peuvent fonder un claim ; n'utilisez jamais les questions ou relances de l'enquêteur comme quote.
- Observation / carnet de terrain : distinguez ce qui est observé de l'interprétation du chercheur.
- Archive / document institutionnel : il s'agit d'un discours produit par une institution ; tenez compte de son auteur et de sa date.
- Tableau : vous recevez une structure et des statistiques déjà calculées par le code. Commentez ce qu'elles permettent d'établir pour la question de recherche ; n'en tirez aucune conclusion causale ; signalez les effectifs faibles.
- Image, graphique, carte, scan : renseignez transcription, description, visualType (photo|graphique|carte|tableau|document) et elementsCles. Signalez les passages illisibles par [illisible] et n'en tirez aucune quote. Les valeurs lues sur un graphique sont approximatives : dites-le.
N'incluez une quote que si elle apparaît mot pour mot dans le texte ou la transcription ; sinon, omettez-la.`;

export const EXTRACT_PROMPT_VERSION = "extract-v5";
