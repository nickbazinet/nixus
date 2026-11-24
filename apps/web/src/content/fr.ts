/**
 * Copie française (français canadien).
 *
 * Traduction, pas transposition littérale : l'anglais est la langue source, mais
 * le français doit se lire comme s'il avait été écrit en français. Le vouvoiement
 * partout, la voix de Nick à la première personne, et la terminologie du produit
 * telle qu'elle existe déjà dans `apps/desktop/src/locales/fr.json` et
 * `apps/account/src/locales/fr.json` : CELI, REER, CELIAPP, valeur nette, relevé,
 * forfait, essai gratuit.
 *
 * Le jeu de mots de la marque est « moins » : Nixus soustrait. « Minus the admin »
 * devient « Moins la paperasse », et « We subtract. You add. » devient
 * « On soustrait. Vous additionnez. »
 *
 * Typographie : espace insécable (U+00A0) avant « : », « ; », « ! », « ? »,
 * à l'intérieur des guillemets français, devant « % » et devant « $ ». Le test
 * `content/copy.test.ts` échoue si une espace ordinaire s'y glisse.
 */

import { TERMS_FR, PRIVACY_POLICY_FR } from "./legal.fr";
import type { SiteCopy } from "./types";

export const FR: SiteCopy = {
  shell: {
    skipToMain: "Aller au contenu principal",
    announcement: {
      text: "Alpha : les utilisateurs fondateurs obtiennent un accès anticipé et un prix réduit, pour toujours.",
      cta: "Voir le programme",
    },
    header: {
      homeAria: "Accueil Nixus",
      navAria: "Principale",
      nav: {
        features: "Fonctionnalités",
        pricing: "Tarifs",
        mission: "Notre mission",
        privacy: "Confidentialité",
        foundingUsers: "Utilisateurs fondateurs",
      },
      logIn: "Se connecter",
      getStarted: "Commencer",
      openMenu: "Ouvrir le menu",
      closeMenu: "Fermer le menu",
    },
    language: {
      label: "Langue",
      short: { en: "EN", fr: "FR" },
      name: { en: "anglais", fr: "français" },
      switchTo: "Voir cette page en {language}",
    },
    footer: {
      tagline: "Moins la paperasse. Les finances personnelles pour les Canadiens.",
      columns: {
        product: "Produit",
        company: "Entreprise",
        follow: "Suivez-nous",
        legal: "Mentions légales",
      },
      links: {
        features: "Fonctionnalités",
        pricing: "Tarifs",
        download: "Télécharger",
        mission: "Notre mission",
        foundingUsers: "Utilisateurs fondateurs",
        github: "GitHub",
        instagram: "Instagram",
        facebook: "Facebook",
        privacy: "Confidentialité",
        privacyPolicy: "Politique de confidentialité",
        terms: "Conditions",
      },
    },
  },

  meta: {
    ogImageAlt: "Nixus — les finances personnelles, moins la paperasse.",
    siteDescription:
      "Nixus soustrait les tableurs, le chaos et le stress. Déposez un relevé de carte de crédit et voyez clairement où vous en êtes et quoi faire ensuite. Gratuit sur votre ordinateur, sans mot de passe bancaire.",
    pages: {
      home: {
        title: "Nixus — Les finances personnelles, moins la paperasse",
        description:
          "Nixus soustrait les tableurs, le chaos et le stress. Déposez un relevé de carte de crédit et voyez clairement où vous en êtes et quoi faire ensuite. Gratuit sur votre ordinateur, sans mot de passe bancaire.",
      },
      features: {
        title: "Fonctionnalités — Nixus",
        description:
          "Import de relevé en quelques secondes, prochaines actions, suivi du CELI, du REER et du CELIAPP, budgets et historique de valeur nette. Les finances personnelles, moins la paperasse.",
      },
      pricing: {
        title: "Tarifs — Nixus",
        description:
          "Nixus est gratuit sur votre ordinateur et ne demande aucun compte. NixusCloud ajoute la vue du ménage et l'IA, et Advance mensuel commence par un essai gratuit de 7 jours que vous pouvez annuler en tout temps avant la fin.",
      },
      mission: {
        title: "Notre mission — Nixus",
        description:
          "Améliorer la stabilité financière du Canadien moyen. Pourquoi Nixus existe, ce qu'il promet, et ce qu'il ne fait pas encore.",
      },
      privacy: {
        title: "Confidentialité — Nixus",
        description:
          "Aucun mot de passe bancaire. Vos données vivent sur votre ordinateur, et rien ne le quitte avant que vous vous connectiez avec un compte Nixus Cloud. Exactement ce qui quitte votre ordinateur, et quand.",
      },
      foundingUsers: {
        title: "Utilisateurs fondateurs — Nixus",
        description:
          "Aidez à bâtir Nixus. Les utilisateurs fondateurs obtiennent un accès anticipé à prix réduit pour de bon, en échange de commentaires honnêtes.",
      },
      download: {
        title: "Télécharger Nixus pour macOS et Windows",
        description:
          "Téléchargez Nixus pour macOS ou Windows. Gratuit sur votre ordinateur, sans compte.",
      },
      terms: {
        title: "Conditions d'utilisation — Nixus",
        description:
          "Les conditions qui régissent votre utilisation de l'application de bureau Nixus, y compris les fonctions IA optionnelles et les services Nixus Cloud.",
      },
      privacyPolicy: {
        title: "Politique de confidentialité — Nixus",
        description:
          "Ce que Nixus stocke sur votre appareil, ce qui le quitte lorsque vous utilisez les fonctions IA, ce que conserve le stockage Nixus Cloud optionnel et qui peut le lire, et comment l'IA hébergée Nixus Cloud premium transmet le contenu à AWS Bedrock.",
      },
      notFound: {
        title: "Page introuvable — Nixus",
        description: "Cette page n'existe pas.",
      },
    },
  },

  visuals: {
    hero: {
      spendingLabel: "Dépenses ce mois-ci",
      spendingDelta: "-6 %",
      spendingAmount: "3 480 $",
      breakdown: "Répartition",
      slices: [
        { label: "Logement", share: "42 %" },
        { label: "Alimentation", share: "28 %" },
        { label: "Transport", share: "18 %" },
      ],
      reminderTitle: "Petit rappel",
      reminderBody: "Vous êtes à 68 % de votre objectif.",
    },
    tourVideoLabel: "Nixus qui importe un relevé et le classe par catégories",
    importCategories: ["Épicerie", "Restaurants", "Transport"],
    registeredAccounts: [
      { label: "CELI", amount: "46 100 $" },
      { label: "REER", amount: "37 100 $" },
      { label: "CELIAPP", amount: "19 200 $" },
    ],
  },

  home: {
    hero: {
      kicker: "Les finances personnelles pour les Canadiens",
      heading: { lead: "Moins la ", accent: "paperasse", tail: "." },
      lead: "Nixus soustrait les tableurs, le chaos et le stress. Vous voyez clairement où vous en êtes et quoi faire ensuite. Déposez un relevé de carte de crédit pour commencer.",
      ctaDownload: "Télécharger Nixus",
      ctaFeatures: "Voir les fonctionnalités",
      platforms:
        "macOS et Windows. Gratuit sur votre ordinateur, sans compte. Aucun mot de passe bancaire.",
      trialLead: "La lecture des relevés par l'IA vient avec NixusCloud Advance.",
      trialLink: "Essayez-la gratuitement 7 jours",
    },
    minus: {
      heading: { first: "Moins", rest: "la ", accent: "paperasse" },
      subtracted: [
        "le casse-tête",
        "le chaos",
        "les tableurs",
        "la complexité",
        "la surcharge",
        "la confusion",
        "les inquiétudes",
      ],
      pitchHeading: "On soustrait les corvées. Vous additionnez les décisions.",
      pitchBody:
        "Nixus classe vos transactions, suit vos budgets et garde votre valeur nette à jour. Vous consacrez votre temps aux choix qui font vraiment bouger votre argent.",
      missionLink: "Lire notre mission",
    },
    features: {
      kicker: "Fonctionnalités",
      heading: "Du relevé au classement en quelques secondes",
      body: "Déposez un relevé de carte de crédit en PDF ou en capture d'écran. Nixus lit chaque transaction et la place dans une catégorie.",
      trialNote:
        "La lecture des relevés par l'IA fait partie de NixusCloud Advance, qui commence par 7 jours gratuits. Une carte est exigée et vous pouvez annuler avant la fin de l'essai.",
      highlights: [
        {
          title: "Prochaines actions",
          body: "Un graphique dit ce qui s'est passé. Nixus dit quoi faire maintenant.",
        },
        {
          title: "CELI, REER et CELIAPP",
          body: "Les comptes enregistrés sont au premier plan, pas en appendice.",
        },
        {
          title: "La valeur nette dans le temps",
          body: "Actifs et passifs dans un seul historique, pour voir la direction.",
        },
      ],
      link: "Explorer toutes les fonctionnalités",
    },
    how: {
      kicker: "Comment ça marche",
      heading: "Opérationnel en trois étapes",
      steps: [
        {
          title: "Téléchargez Nixus",
          body: "Installez Nixus sur macOS ou Windows. Aucun compte requis.",
        },
        {
          title: "Déposez un relevé",
          body: "Un PDF ou une capture de votre carte de crédit. Nixus le classe.",
        },
        {
          title: "Voyez où vous en êtes",
          body: "Budgets, valeur nette et prochaines actions, prêts à consulter.",
        },
      ],
    },
    mission: {
      kicker: "Notre mission",
      heading: "Améliorer la stabilité financière du Canadien moyen.",
      body: "Du savoir et des conseils pour le monde ordinaire, avec les décisions de routine automatisées. Bâti par une seule personne qui voulait que ça existe.",
      cta: "Lire l'histoire",
    },
    pricing: {
      kicker: "Tarifs",
      headingLines: ["Gratuit sur votre ordinateur.", "L'infonuagique quand vous le voulez."],
      trialThen: ", puis le prix mensuel.",
      compareLink: "Comparer les forfaits",
    },
    founding: {
      kicker: "Utilisateurs fondateurs",
      heading: "Aidez à bâtir Nixus. Ayez-le en premier, et payez moins, pour toujours.",
      body: "Un accès anticipé à la plateforme à prix réduit pour de bon, en échange de commentaires honnêtes et de conversations régulières avec moi.",
      cta: "Devenir utilisateur fondateur",
    },
    closing: {
      kicker: "On soustrait. Vous additionnez.",
      heading: {
        lead: "Arrêtez de faire rouler un tableur. ",
        accent: "Prenez les commandes de votre argent.",
        tail: "",
      },
      subtractTitle: "On soustrait",
      subtractItems: [
        "Le tableur que vous refaites chaque mois",
        "Le classement de chaque transaction à la main",
        "Les devinettes sur quoi faire avec ce qui reste",
      ],
      addTitle: "Vous additionnez",
      addItems: [
        "Une vue claire de votre situation",
        "Une prochaine étape chaque fois que vous l'ouvrez",
        "De la confiance dans vos décisions d'argent",
      ],
      footnote: "Gratuit sur votre ordinateur. Aucun compte, aucun mot de passe bancaire.",
      trialFootnote:
        "Vous voulez l'import de relevés par l'IA ? NixusCloud Advance est gratuit vos 7 premiers jours.",
      cta: "Télécharger Nixus",
    },
  },

  features: {
    kicker: "Fonctionnalités",
    heading: { first: "Moins de corvées.", accent: "Plus de clarté", tail: "." },
    lead: "Nixus retire les corvées de la gestion de l'argent ; il ne reste que la partie qui compte : savoir où vous en êtes et décider quoi faire ensuite.",
    subtractTitle: "On soustrait",
    subtractItems: [
      "La saisie des transactions à la main",
      "Le classement de chaque achat dans une catégorie",
      "Le doute sur quoi faire ensuite",
      "Les feuilles séparées pour chaque compte",
    ],
    addTitle: "Vous additionnez",
    addItems: [
      "Une vue claire de votre valeur nette et de vos budgets",
      "Une courte liste de prochaines actions à chaque ouverture",
      "Le CELI, le REER et le CELIAPP suivis avec le reste",
      "De la confiance dans vos décisions d'argent",
    ],
    ctaDownload: "Télécharger Nixus",
    ctaPricing: "Voir les forfaits",
    rows: [
      {
        heading: "Du relevé au classement en quelques secondes",
        body: "Déposez un relevé de carte de crédit en PDF ou en capture d'écran. Nixus lit chaque transaction et la place dans une catégorie : la saisie disparaît.",
        points: [
          "Import de PDF et de captures d'écran",
          "Des catégories automatiques que vous pouvez corriger",
          "Vos relevés restent privés et ne servent jamais à entraîner l'IA",
          "Compris dans NixusCloud Advance, gratuit vos 7 premiers jours",
        ],
      },
      {
        heading: "Un graphique dit ce qui s'est passé. Nixus dit quoi faire.",
        body: "Chaque fois que vous ouvrez l'application, vous obtenez une courte liste de prochaines actions : un budget qui dérape, des droits de cotisation que vous n'avez pas utilisés.",
        points: [
          "Priorisées, courtes, précises",
          "Basées sur vos propres chiffres",
          "En langage simple, sans jargon",
        ],
      },
      {
        heading: "Le CELI, le REER et le CELIAPP au premier plan",
        body: "Suivez vos comptes enregistrés à côté de tout le reste, pour que les comptes les plus importants pour les Canadiens ne soient pas une réflexion après coup.",
        points: [
          "Les soldes de chaque compte enregistré",
          "Les droits de cotisation d'un coup d'œil",
          "Compris dans votre valeur nette",
        ],
      },
      {
        heading: "Budgets et valeur nette, mois après mois",
        body: "Voyez chaque catégorie par rapport à sa limite, et regardez vos actifs et vos passifs se placer dans un seul historique digne de confiance.",
        points: [
          "Des budgets par catégorie, avec les dépassements bien visibles",
          "Un historique de valeur nette, de 1 mois à tout l'historique",
          "Tout est calculé sur votre ordinateur",
        ],
      },
    ],
    toolbox: {
      kicker: "Et plus encore",
      heading: "Le reste du coffre à outils",
      body: "Du flux de trésorerie quotidien jusqu'à la retraite, et même votre auto : tout ce que Nixus garde organisé pour vous.",
      items: [
        {
          title: "Un flux de trésorerie limpide",
          body: "Suivez chaque dépense et chaque revenu pour toujours savoir ce qui est entré, ce qui est sorti et ce qui reste.",
        },
        {
          title: "Tous vos comptes, en CAD et en USD",
          body: "Banques, cartes, placements, immobilier et plus, en dollars canadiens et américains, au même endroit.",
        },
        {
          title: "Objectifs d'épargne",
          body: "Planifiez ce pour quoi vous épargnez, financez-le au fil du temps et voyez où vous en êtes.",
        },
        {
          title: "Tendances et bilan de l'année",
          body: "Repérez les tendances de dépenses dès qu'elles se forment, puis revoyez toute l'année d'un coup d'œil.",
        },
        {
          title: "Projections et retraite",
          body: "Projetez votre valeur nette vers l'avant et testez votre plan de retraite avant de vous engager.",
        },
        {
          title: "Un garage pour chaque véhicule",
          body: "Gardez plusieurs véhicules, avec les calendriers d'entretien, l'historique complet et des alertes avant les échéances.",
        },
        {
          title: "Posez des questions sur votre argent",
          body: "Posez vos questions en langage simple, comme où est passé le mois dernier, et obtenez une réponse tirée de vos propres chiffres.",
        },
        {
          title: "Posez des questions sur votre auto",
          body: "Vous vous demandez quand faire le prochain changement d'huile ? Demandez-le : la réponse vient de votre historique d'entretien.",
        },
        {
          title: "Privé par conception",
          body: "Aucun mot de passe bancaire, aucune connexion à votre banque. Vos données restent sur votre ordinateur.",
        },
      ],
      privacyLink: "Comment nous protégeons vos données",
    },
    why: {
      kicker: "Pourquoi Nixus",
      heading: "La plupart des gens choisissent entre le travail et la confiance",
      lead: "Nixus est la troisième option.",
      cards: [
        {
          title: "Un tableur",
          body: "Vous gardez le contrôle, et vous faites toute la saisie. Il ne dit ce qui s'est passé que si vous le bâtissez pour ça.",
        },
        {
          title: "Les applis connectées à la banque",
          body: "Automatiques, mais elles veulent généralement vos identifiants bancaires et gardent vos données sur leurs serveurs.",
        },
        {
          title: "Nixus",
          body: "Importez un relevé en quelques secondes. Vos données restent sur votre ordinateur. On vous dit quoi faire ensuite.",
        },
      ],
    },
    closing: {
      heading: "Essayez-le sur votre propre relevé",
      body: "Gratuit sur votre ordinateur, sans compte. L'import de relevés par l'IA fait partie de NixusCloud Advance, qui commence par 7 jours gratuits — une carte est exigée, et vous pouvez annuler avant la fin de l'essai.",
      cta: "Télécharger Nixus",
    },
  },

  pricing: {
    kicker: "Tarifs",
    heading: {
      first: "Gratuit sur votre ordinateur.",
      accent: "Les capacités infonuagiques",
      tail: ", quand vous le voulez.",
    },
    lead: "Utiliser Nixus sur votre ordinateur ne coûte rien et ne demande aucun compte. NixusCloud ajoute la vue du ménage et l'IA, et Advance commence par 7 jours gratuits.",
    taxNote:
      "Les prix sont en dollars canadiens, taxes comprises. À l'extérieur du Canada, le paiement affiche le prix dans votre propre devise. Les paiements sont traités par Stripe.",
    plans: {
      free: {
        name: "Nixus Gratuit",
        shortName: "Gratuit",
        tagline: "Votre propre profil, sur votre ordinateur. Aucun compte requis.",
        teaser: "Votre propre profil, sur votre ordinateur. Aucun compte requis.",
        features: [
          "Budgets et historique de valeur nette",
          "Suivi du CELI, du REER et du CELIAPP",
          "Prochaines actions et Garage",
        ],
      },
      classic: {
        name: "NixusCloud Classic",
        shortName: "Classic",
        tagline: "Votre argent, pour tout votre ménage.",
        teaser: "La valeur nette du ménage, dans une seule vue.",
        features: ["Tout ce qu'il y a dans Gratuit", "Valeur nette du ménage"],
      },
      advance: {
        name: "NixusCloud Advance",
        shortName: "Advance",
        tagline: "Classic, plus les conseils de l'IA et des tableaux de bord que vous façonnez.",
        teaser: "Ajoute l'intégration de l'IA et les tableaux de bord personnalisés.",
        badge: "IA comprise",
        features: [
          "Tout ce qu'il y a dans Classic",
          "Import et catégories de relevés par l'IA",
          "Assistants IA",
          "Tableaux de bord personnalisés",
        ],
      },
    },
    trial: {
      badge: "7 jours gratuits",
      cta: "Commencer l'essai gratuit de 7 jours",
      microcopy:
        "7 jours gratuits, puis {price}. Une carte est exigée. Annulez en tout temps avant la fin de l'essai et vous ne serez pas facturé.",
      secondaryCta: "Ou abonnez-vous tout de suite, sans essai",
    },
    choosePlan: "Choisir {plan}",
    downloadCta: "Télécharger Nixus",
    compare: {
      heading: "Comparer les forfaits",
      lead: "Tout ce qu'il vous faut pour suivre votre argent est gratuit sur votre ordinateur. Les forfaits infonuagiques ajoutent la vue du ménage, une IA qui répond à partir de vos propres chiffres, et des tableaux de bord bâtis à votre façon.",
      caption: "Fonctionnalités comprises dans chaque forfait Nixus",
      featureColumn: "Fonctionnalité",
      included: "Compris",
      notIncluded: "Non compris",
      groups: [
        {
          rows: [
            {
              label: "Budgets et flux de trésorerie",
              hint: "Budgets mensuels, dépenses et revenus, et où vous en êtes.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Comptes et actifs en CAD et en USD",
              hint: "Banques, cartes, placements et immobilier.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Historique de valeur nette",
              hint: "Regardez-la croître avec le temps, de 1 mois à tout l'historique.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Suivi du CELI, du REER et du CELIAPP",
              hint: "Soldes et droits de cotisation à côté de tout le reste.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Objectifs d'épargne",
              hint: "Planifiez et financez ce pour quoi vous épargnez.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Analyses, projections et planification de la retraite",
              hint: "Tendances de dépenses, bilan de l'année et projections de valeur nette.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Prochaines actions",
              hint: "Une courte liste priorisée chaque fois que vous ouvrez l'application.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Garage avec alertes d'entretien",
              hint: "Plusieurs véhicules, historique d'entretien et alertes d'échéance.",
              values: { free: true, classic: true, advance: true },
            },
          ],
        },
        {
          rows: [
            {
              label: "Sauvegarde et synchronisation infonuagiques",
              hint: "Gratuit garde tout sur votre ordinateur seulement. L'infonuagique garde une copie en sécurité et synchronise vos appareils : un ordinateur perdu ou brisé ne veut plus dire des données perdues.",
              values: { free: false, classic: true, advance: true },
            },
            {
              label: "Valeur nette du ménage",
              hint: "Une seule vue de ce que votre ménage possède et de ce qu'il doit.",
              values: { free: false, classic: true, advance: true },
            },
          ],
        },
        {
          rows: [
            {
              label: "Import et catégories de relevés par l'IA",
              hint: "Déposez un PDF ou une capture d'écran : chaque transaction est lue et classée.",
              values: { free: false, classic: false, advance: true },
            },
            {
              label: "Assistant IA pour votre argent",
              hint: "Demandez en langage simple où est passé votre argent et obtenez des réponses tirées de vos propres chiffres.",
              values: { free: false, classic: false, advance: true },
            },
            {
              label: "Assistant IA pour votre auto",
              hint: "Posez vos questions sur les calendriers et l'historique d'entretien.",
              values: { free: false, classic: false, advance: true },
            },
            {
              label: "Tableaux de bord personnalisés",
              hint: "Bâtissez la vue d'ensemble que vous voulez, avec les chiffres qui vous importent.",
              values: { free: false, classic: false, advance: true },
            },
          ],
        },
        {
          rows: [
            {
              label: "Aucun mot de passe ni connexion bancaire",
              hint: "Vous choisissez les relevés à importer, sur tous les forfaits.",
              values: { free: true, classic: true, advance: true },
            },
            {
              label: "Compte requis",
              values: { free: "Non", classic: "Oui", advance: "Oui" },
            },
            {
              label: "Essai gratuit",
              hint: "Advance mensuel commence par 7 jours gratuits. Une carte est exigée, et l'abonnement se poursuit comme forfait mensuel payant à moins que vous annuliez avant la fin de l'essai.",
              values: { free: "Pas nécessaire", classic: "Non", advance: "7 jours" },
            },
          ],
        },
      ],
    },
    founding: {
      kicker: "Utilisateurs fondateurs",
      heading: "Un accès anticipé, à prix réduit, pour toujours.",
      body: "Joignez-vous tôt à l'alpha, dites-nous ce qui fonctionne et ce qui ne fonctionne pas, et gardez un prix plus bas pour de bon.",
      cta: "Voir le programme",
    },
    faqHeading: "Questions sur les tarifs",
    faq: [
      {
        question: "Ai-je besoin d'un compte ?",
        answer:
          "Pas pour Nixus Gratuit. Vous créez un profil sur votre propre ordinateur, et c'est tout. Un compte n'est nécessaire que pour NixusCloud, parce que la vue du ménage et l'IA passent par lui.",
      },
      {
        question: "Nixus sur mon ordinateur est-il vraiment gratuit ?",
        answer:
          "Oui. Les budgets, le flux de trésorerie, l'historique de valeur nette, les comptes enregistrés, les objectifs d'épargne, les prochaines actions et le Garage fonctionnent tous sur votre ordinateur sans frais, sans limite de temps et sans carte. Ce n'est pas un essai qui finit par expirer. L'essai gratuit de 7 jours est autre chose : il vous laisse essayer les fonctions payantes de NixusCloud Advance avant de les payer.",
      },
      {
        question: "Comment fonctionne l'essai gratuit ?",
        answer:
          "NixusCloud Advance mensuel commence par 7 jours gratuits. Vous vous connectez, vous entrez une carte sur la page sécurisée de Stripe, et vous obtenez tout de suite toutes les fonctions Advance — l'import de relevés par l'IA, les assistants IA, les tableaux de bord personnalisés et la vue du ménage. L'essai s'applique uniquement à Advance mensuel, pas au prix annuel ni à Classic.",
      },
      {
        question: "Serai-je facturé pendant l'essai ?",
        answer:
          "Non. Une carte est exigée au départ, parce que l'essai se transforme de lui-même en abonnement payant, mais rien n'est facturé pendant les 7 premiers jours. Stripe peut brièvement valider la carte, ce que certaines banques affichent comme une retenue temporaire et jamais comme un paiement.",
      },
      {
        question: "Que se passe-t-il à la fin de l'essai ?",
        answer:
          "Le 8e jour, votre abonnement se poursuit automatiquement comme NixusCloud Advance mensuel payant, au prix affiché ci-dessus, et votre carte est débitée à ce moment-là. Il se renouvelle chaque mois jusqu'à ce que vous annuliez. Stripe vous écrit avant la fin de l'essai, pour que le paiement ne soit jamais une surprise.",
      },
      {
        question: "Puis-je annuler pendant l'essai ?",
        answer:
          "Oui, à n'importe quel moment avant la fin, et vous ne serez pas facturé. Allez à account.nixusapp.com, ouvrez Gérer le forfait, et annulez dans le portail de facturation de Stripe. Vous gardez Advance jusqu'au jour où l'essai devait se terminer, puis le compte revient au forfait gratuit. Rien n'est perdu sur votre ordinateur dans un cas comme dans l'autre : vos données vivent dans un fichier sur votre propre machine.",
      },
      {
        question: "Puis-je utiliser l'essai gratuit plus d'une fois ?",
        answer:
          "L'essai est prévu comme un seul par personne, et Nixus peut refuser un essai répété. Si vous avez déjà eu Advance, vous pouvez tout de même vous abonner au prix régulier en tout temps.",
      },
      {
        question: "Dois-je connecter ma banque ?",
        answer:
          "Non. Nixus ne demande jamais votre mot de passe bancaire. Vous importez un relevé de carte de crédit en PDF ou en capture d'écran, et vous choisissez lesquels.",
      },
      {
        question: "Puis-je annuler NixusCloud et garder mes données ?",
        answer:
          "Oui. Vos données vivent sur votre ordinateur : annuler désactive seulement les fonctions infonuagiques liées à votre forfait. Cela ne supprime jamais ce qui se trouve sur votre machine.",
      },
      {
        question: "Que se passe-t-il si l'alpha cesse d'être mise à jour ?",
        answer:
          "Vos données sont un fichier sur votre propre ordinateur et le code est ouvert : l'application continue de fonctionner avec ce que vous avez, et n'importe qui peut lire ou compiler le code.",
      },
      {
        question: "À qui je paie, et les taxes sont-elles comprises ?",
        answer:
          "Stripe vend NixusCloud et en est le vendeur officiel : vous payez sur les pages sécurisées de Stripe et Nixus ne voit ni ne conserve jamais votre carte. Les prix sont affichés en dollars canadiens, taxes comprises, et à l'extérieur du Canada le paiement affiche le prix dans votre propre devise. Vous pouvez annuler, changer de carte et changer de forfait depuis votre compte, et les remboursements passent par Stripe.",
      },
      {
        question: "Est-ce un conseil financier ?",
        answer:
          "Non. Nixus est un outil pour suivre et organiser votre argent. Ses suggestions sont éducatives, et non des conseils fiscaux, juridiques ou en placement ; c'est vous qui décidez quoi faire.",
      },
    ],
  },

  mission: {
    kicker: "Notre mission",
    heading: {
      lead: "Améliorer la stabilité financière du ",
      accent: "Canadien moyen",
      tail: ".",
    },
    lead: "Pas un expert en finances. Pas quelqu'un avec une fin de semaine à perdre. La personne moyenne, avec une vraie vie et un budget à gérer.",
    goals: {
      kicker: "Comment on y arrive",
      heading: "Quatre objectifs",
      items: [
        {
          title: "Du savoir et des conseils",
          body: "Les bonnes pratiques pour le monde ordinaire, en langage simple. Aucun diplôme en finances requis.",
        },
        {
          title: "Automatiser les décisions financières",
          body: "Laissez l'application gérer les choix de routine, pour que les bonnes habitudes deviennent la norme.",
        },
        {
          title: "Automatiser le reste de la vie",
          body: "L'argent est un début. Le Garage suit déjà l'entretien des véhicules, et d'autres suivront.",
        },
        {
          title: "Se servir de la technologie pour y arriver",
          body: "Vos données restent sur votre ordinateur, le code est ouvert, et l'IA ne sert que là où elle aide et là où vous y consentez.",
        },
      ],
    },
    founder: {
      photoAlt: "Nick, fondateur de Nixus",
      name: "Nick",
      role: "Fondateur de Nixus",
      kicker: "Pourquoi je bâtis ça",
      heading: "Bâti par une seule personne qui voulait que ça existe",
      paragraphs: [
        "J'ai bâti mon propre budget pendant des années. Chaque fois que je parlais d'argent avec les gens autour de moi, je trouvais la même chose : on s'était tous bâti le nôtre, un tableur à la fois.",
        "Devenir responsable financièrement a changé ma vie pour le mieux. Je veux que tout le monde autour de moi ait ça, sans réinventer la roue. Alors j'apporte l'automatisation et les bonnes pratiques à tout le monde.",
        "Je voulais un outil qui dit quoi faire ensuite, pas seulement ce qui s'est passé, sans remettre mon mot de passe bancaire à une entreprise. Nixus est en alpha, son code est ouvert, et je vais vous dire franchement ce qu'il ne fait pas encore. Si vous l'essayez, vous avez une ligne directe avec moi.",
      ],
    },
    promises: {
      kicker: "Promesses",
      heading: "Ce que vous pouvez exiger de moi",
      items: [
        {
          title: "Vos données restent les vôtres",
          body: "Vos données restent sur votre ordinateur par conception. Les fonctions infonuagiques sont optionnelles.",
        },
        { title: "Code ouvert", body: "Lisez le code, pas seulement la promesse." },
        {
          title: "Franc sur les limites",
          body: "Je vais vous dire ce que Nixus ne fait pas encore, avant que vous le découvriez.",
        },
      ],
      worksTitle: "Ce qui fonctionne aujourd'hui",
      worksItems: [
        "L'import de relevés de carte de crédit",
        "Les budgets et le flux de trésorerie",
        "L'historique et les projections de valeur nette",
        "Les analyses de dépenses et le bilan de l'année",
        "Les projections de retraite",
        "La vue d'ensemble des placements",
        "Le suivi des comptes enregistrés (CELI, REER, CELIAPP)",
        "Les objectifs d'épargne",
        "Le garage d'entretien automobile",
      ],
      isntTitle: "Ce qu'il n'est pas",
      isntItems: [
        "Aucune connexion bancaire",
        "Aucune application mobile (pour l'instant)",
        "Pas un conseil financier professionnel",
      ],
    },
    closing: {
      heading: "Aidez-moi à le bâtir",
      body: "Les utilisateurs fondateurs façonnent Nixus dès le départ et gardent un prix réduit pour de bon.",
      cta: "Devenir utilisateur fondateur",
    },
  },

  privacy: {
    kicker: "Confidentialité",
    heading: { lead: "Vos données restent ", accent: "là où vous les mettez", tail: "." },
    lead: "Aucun mot de passe bancaire. Vos données vivent sur votre ordinateur. Les fonctions infonuagiques vont plus loin, et rien ne part avant que vous vous connectiez avec un compte Nixus Cloud.",
    layers: {
      kicker: "Trois couches",
      heading: "Ce qui reste, et ce qui peut partir",
      lead: "La majeure partie de Nixus tourne sur votre propre ordinateur, pas sur le nôtre, et tout ce qui va plus loin est optionnel.",
      items: [
        {
          badge: "Toujours actif",
          title: "Sur votre ordinateur",
          lead: "Enregistré sur votre ordinateur, pas sur nos serveurs.",
          body: "Vos transactions, vos budgets et vos comptes vivent dans un fichier sur votre propre ordinateur, un peu comme un document. Rien ne nous est envoyé, donc il n'y a aucun compte à créer.",
          points: [
            "Personne d'autre ne détient vos données financières",
            "Rien à faire fuir d'une base de données d'entreprise",
            "Vous les gardez, et vous pouvez les supprimer en tout temps",
          ],
        },
        {
          badge: "Optionnel · Classic",
          title: "Synchronisation infonuagique",
          lead: "Protégée, et à vous seul.",
          body: "Si vous l'activez, une copie de vos données est conservée sur des serveurs sécurisés, dans un espace qui n'appartient qu'à votre compte. Nixus ne lit pas vos données.",
          points: [
            "Chiffrée pendant le transport et pendant le stockage",
            "Désactivée jusqu'à ce que vous l'activiez",
            "Vos identifiants d'IA ne sont jamais téléversés",
            "Suppression sur demande, par courriel",
          ],
        },
        {
          badge: "Optionnel · Advance",
          title: "Requêtes IA",
          lead: "Seulement ce que vous demandez, seulement quand vous le demandez.",
          body: "Rien n'est envoyé avant que vous importiez un relevé ou que vous posiez une question à l'assistant. Nixus ne le conserve pas.",
          points: [
            "Votre relevé reste privé",
            "Jamais utilisé ni partagé par le service d'IA",
            "Vous préférez éviter nos serveurs ? Utilisez votre propre fournisseur d'IA",
          ],
        },
      ],
    },
    flows: {
      heading: "Exactement ce qui quitte votre ordinateur",
      columnSituation: "Situation",
      columnSent: "Ce qui est envoyé",
      columnControl: "Votre contrôle",
      rows: [
        {
          situation: "Sur votre ordinateur",
          situationNote: "votre profil Nixus",
          sent: "Rien.",
          control: "Aucun compte, rien à désactiver.",
        },
        {
          situation: "Votre banque",
          sent: "Rien qui vienne de votre banque. Nixus ne demande jamais votre mot de passe bancaire. Vous importez les relevés vous-même, et quand l'IA en lit un, ce relevé est envoyé comme requête IA (ci-dessous).",
          control:
            "Vous choisissez les relevés à importer, et vous pouvez les supprimer en tout temps.",
        },
        {
          situation: "Synchronisation infonuagique",
          sent: "Une copie chiffrée de vos données : budgets, transactions, comptes et historique de valeur nette. Conservée sur des serveurs sécurisés.",
          control:
            "Désactivée pour un profil local, qui ne demande aucun compte. Activée automatiquement pour un profil Nixus Cloud dont le forfait la comprend, et vous pouvez la désactiver pour ce profil. La désactiver arrête les transferts, et vous pouvez nous demander par courriel de supprimer la copie conservée.",
        },
        {
          situation: "Compte Nixus Cloud",
          sent: "Votre profil : nom, date de naissance, tranche de revenu, lieu et une photo facultative. Conservé sur des serveurs sécurisés aux États-Unis.",
          control:
            "Uniquement avec un compte Nixus Cloud. Un profil local seulement ne le téléverse jamais. Demandez-nous par courriel de le supprimer.",
        },
        {
          situation: "Requêtes IA",
          sent: "Uniquement la requête que vous faites, comme un relevé ou une question. Elle reste privée, et Nixus ne la stocke pas, seulement le nombre de requêtes que vous avez faites.",
          control:
            "Uniquement quand vous lancez une requête. Utilisez votre propre fournisseur d'IA et elle y va directement, jamais par Nixus.",
        },
      ],
      policyNoteLead: "Le texte légal complet se trouve dans notre",
      policyNoteLink: "politique de confidentialité",
    },
    noLogins: {
      kicker: "Aucun mot de passe bancaire",
      heading: "Pourquoi vous téléversez des relevés à la place",
      body: "Connecter une banque veut dire remettre vos identifiants, ou les confier à un tiers. Téléverser un relevé ne donne à Nixus que ce dont il a besoin, et garde le reste de vos opérations bancaires en dehors de ça.",
    },
    openSource: {
      kicker: "Code ouvert",
      heading: "Lisez le code, pas seulement la promesse",
      body: "Le code de Nixus est ouvert : n'importe qui peut vérifier ce qu'il fait avec vos données.",
      link: "Voir le code source sur GitHub",
    },
    closing: {
      heading: "Essayez-le sans que rien ne quitte votre ordinateur",
      cta: "Télécharger Nixus",
    },
  },

  foundingUsers: {
    kicker: "Utilisateurs fondateurs",
    heading: {
      lead: "Aidez à bâtir Nixus. Ayez-le en premier, et ",
      accent: "payez moins, pour toujours",
      tail: ".",
    },
    noteTitle: "Un mot de Nick",
    noteBody: "Vous m'aidez, je vous aide. Un petit cadeau pour m'aider à réaliser mon rêve.",
    lead: "Les utilisateurs fondateurs obtiennent un accès anticipé à la plateforme à prix réduit pour de bon, en échange de commentaires honnêtes et de conversations régulières avec moi.",
    cta: "Postuler comme utilisateur fondateur",
    benefits: {
      kicker: "Ce que vous obtenez",
      heading: "Trois choses, pour de bon",
      items: [
        {
          title: "Accès anticipé",
          body: "Utilisez la plateforme avant tout le monde, y compris les nouvelles fonctions dès leur arrivée.",
        },
        {
          title: "Un prix réduit, pour toujours",
          body: "50 % de rabais sur tous les forfaits NixusCloud, aussi longtemps que vous restez.",
        },
        {
          title: "Une ligne directe avec moi",
          body: "Je lis chaque message. Vous parlez à la personne qui le bâtit, pas à une file de soutien.",
        },
      ],
    },
    ask: {
      kicker: "Ce que je demande en retour",
      heading: "Des commentaires honnêtes, et de vraies conversations",
      body: "Ça ne marche que si vous me dites la vérité sur ce qui est bon, ce qui est mauvais et ce qui pourrait être mieux.",
      items: [
        "Dites-moi ce qui fonctionne et ce qui ne fonctionne pas, le bon comme le mauvais",
        "Proposez des améliorations, petites ou grandes",
        "Parlez-moi régulièrement de la façon d'améliorer Nixus, par courriel ou lors d'un court appel quand ça vous convient",
      ],
    },
    how: {
      kicker: "Comment ça marche",
      heading: "De la candidature au premier appel",
      steps: [
        { title: "Postulez", body: "Dites-moi un peu comment vous gérez votre argent aujourd'hui." },
        { title: "Obtenez l'accès", body: "Je vous envoie votre invitation et je fixe votre prix." },
        {
          title: "Parlez-moi",
          body: "Utilisez-le, dites-moi ce que vous en pensez, et voyez-le changer.",
        },
      ],
    },
    apply: {
      kicker: "Postuler",
      heading: "Je lis chaque candidature moi-même",
      body: "Parlez-moi un peu de vous. Il n'y a pas de mauvaise réponse.",
    },
    form: {
      nameLabel: "Nom",
      emailLabel: "Courriel",
      emailPlaceholder: "vous@exemple.com",
      todayLabel: "Comment gérez-vous votre argent aujourd'hui ?",
      todayOptions: [
        "Un tableur",
        "Une appli connectée à la banque",
        "Papier et crayon",
        "Dans ma tête",
        "Autre chose",
      ],
      noBrainerLabel: "Qu'est-ce qui ferait de Nixus une évidence pour vous ?",
      submit: "Postuler comme utilisateur fondateur",
      privacyNote:
        "Je réponds personnellement à chaque candidature. Vos réponses ne vont qu'à moi, par courriel, et servent uniquement à faire un suivi avec vous.",
      sentNote:
        "Votre application de courriel devrait s'ouvrir avec vos réponses. Si ce n'est pas le cas, écrivez à {email}.",
      mailSubject: "Candidature d'utilisateur fondateur — {name}",
      mailSubjectNoName: "Candidature d'utilisateur fondateur",
      mailNameLabel: "Nom",
      mailEmailLabel: "Courriel",
      mailTodayLabel: "Comment je gère mon argent aujourd'hui",
      mailNoBrainerLabel: "Ce qui ferait de Nixus une évidence pour moi :",
    },
  },

  download: {
    kicker: "Télécharger",
    heading: { lead: "Obtenez Nixus, ", accent: "moins la paperasse", tail: "." },
    lead: "Nixus fonctionne sur macOS et Windows. Nixus est gratuit sur votre ordinateur et ne demande aucun compte.",
    platforms: [
      { name: "macOS", label: "Télécharger pour macOS" },
      { name: "Windows", label: "Télécharger pour Windows" },
    ],
    firstRun: {
      kicker: "Après l'installation",
      heading: "Vos cinq premières minutes",
      items: [
        "Créez votre profil gratuit sur votre ordinateur. Aucun compte.",
        "Déposez un relevé de carte de crédit.",
        "Vérifiez les catégories, puis consultez votre vue d'ensemble.",
      ],
    },
    more: {
      kicker: "Vous en voulez plus ?",
      heading: "Vue du ménage et IA",
      body: "Elles viennent avec NixusCloud, qui demande un compte.",
      trialNote:
        "NixusCloud Advance commence par 7 jours gratuits. Une carte est exigée, l'abonnement se poursuit comme forfait mensuel payant à la fin de l'essai, et vous pouvez annuler avant sans frais.",
      plansLink: "Voir les forfaits",
      accountLink: "Se connecter ou créer un compte",
    },
  },

  notFound: {
    heading: "Cette page a disparu",
    body: "Elle a peut-être changé d'adresse lors de la refonte du site.",
    cta: "Retour à l'accueil",
  },

  legal: {
    lastUpdated: "Dernière mise à jour : 24 novembre 2026",
    backHome: "Retour à l'accueil",
    terms: TERMS_FR,
    privacyPolicy: PRIVACY_POLICY_FR,
  },
};
