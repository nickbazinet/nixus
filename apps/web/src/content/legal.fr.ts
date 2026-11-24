/**
 * Conditions d'utilisation et Politique de confidentialité, en français.
 *
 * Traduction du texte anglais de `legal.en.ts`, section pour section et
 * paragraphe pour paragraphe : les deux documents doivent dire exactement la
 * même chose, et le test de parité structurelle vérifie que le découpage reste
 * identique. Typographie française : espace insécable avant « : », « ; »,
 * « ! », « ? » et à l'intérieur des guillemets.
 */

import type { LegalDocument } from "./types";

export const TERMS_FR: LegalDocument = {
  heading: "Conditions d'utilisation",
  intro:
    "Ces conditions régissent votre utilisation de l'application de bureau Nixus et des services Nixus Cloud optionnels. Nixus est un logiciel en alpha fourni tel quel.",
  sections: [
    {
      heading: "Acceptation",
      paragraphs: [
        "En installant ou en utilisant Nixus, vous acceptez ces conditions ainsi que la Politique de confidentialité. Si vous ne les acceptez pas, n'utilisez pas l'application.",
      ],
    },
    {
      heading: "Fonctions IA",
      paragraphs: [
        "Nixus comprend des fonctions IA optionnelles. Elles ne s'exécutent que lorsque vous les lancez, et en exécuter une transmet le contenu de cette requête — qui peut comprendre des transactions financières ainsi qu'une image ou un PDF de relevé téléversé — hors de votre appareil pour traitement.",
        "Par défaut, vous fournissez vos propres identifiants de fournisseur d'IA (AWS Bedrock ou OpenAI). Ces requêtes vont directement de votre appareil à ce fournisseur, selon votre propre entente avec lui, et l'infrastructure de Nixus n'est pas impliquée.",
        "Si l'option premium de Nixus Cloud est activée sur votre compte, les requêtes IA sont plutôt transmises par l'infrastructure de Nixus vers Amazon Bedrock, exploité par Amazon Web Services. Nixus choisit le modèle et applique une limite mensuelle sur le nombre de requêtes. Le traitement utilise un profil d'inférence Bedrock interrégional limité aux États-Unis ; une requête peut donc être traitée dans n'importe quelle région AWS américaine, ce qui peut se trouver à l'extérieur de votre pays de résidence. Consultez la Politique de confidentialité pour savoir comment ce contenu est traité.",
        "Avec un compte premium, l'IA hébergée a priorité : une requête admissible est envoyée par Nixus vers Amazon Bedrock même si vous avez configuré votre propre fournisseur d'IA pour cette fonction. Nixus n'offre aucun réglage dans l'application pour choisir entre les deux. Votre propre fournisseur n'est utilisé que si l'IA hébergée est indisponible, si votre quota mensuel est épuisé, ou si votre compte n'est pas premium.",
      ],
    },
    {
      heading: "Quota de requêtes",
      paragraphs: [
        "L'IA hébergée premium est soumise à un quota mensuel de requêtes et à une limite globale de capacité du service, tous deux fixés à la discrétion de Nixus et modifiables sans préavis. Lorsque votre quota est épuisé, que le service est indisponible ou que l'IA hébergée est désactivée, Nixus se replie sur le fournisseur d'IA que vous avez configuré vous-même, lorsque celui-ci prend la fonction en charge. Si aucun repli n'est possible, la fonction signale une erreur. Aucune autre partie de l'application n'est touchée.",
      ],
    },
    {
      heading: "Stockage Nixus Cloud optionnel",
      paragraphs: [
        "Certaines fonctions de Nixus Cloud peuvent conserver une copie de vos données dans un espace de stockage infonuagique exploité par Nixus. Elles sont offertes aux comptes Nixus Cloud admissibles et ne s'appliquent jamais à un profil local. La Politique de confidentialité explique comment cette copie est stockée et qui pourrait techniquement la lire.",
        "La synchronisation est désactivée pour un profil local, qui est la façon par défaut d'utiliser Nixus et ne demande aucun compte. Lorsque vous vous connectez avec un compte Nixus Cloud dont le forfait comprend la synchronisation, celle-ci est activée automatiquement pour ce profil Cloud et ses données sont copiées vers Nixus Cloud. Vous pouvez la désactiver pour ce profil à tout moment, et vous pouvez continuer d'utiliser un profil local à la place.",
        "Ces fonctions font partie de l'alpha. Leur disponibilité n'est pas garantie : elles peuvent être modifiées, interrompues ou retirées, et des transferts peuvent échouer ou être retardés. Nixus peut les suspendre pour un compte, notamment en cas d'abus ou de coûts excessifs. Si un compte cesse d'être admissible, elles cessent de fonctionner et l'application continue de fonctionner avec vos données locales.",
      ],
    },
    {
      heading: "Votre profil Nixus Cloud",
      paragraphs: [
        "Chaque compte Nixus Cloud possède un seul profil — prénom et nom, date de naissance, tranche de revenu et sa devise, pays et état, province ou région, ainsi qu'une photo facultative — stocké dans une base de données exploitée par Nixus sur Amazon Web Services, aux États-Unis. Vous pouvez le modifier depuis l'application de bureau ou depuis account.nixusapp.com ; les deux nécessitent une connexion Internet pour enregistrer. Un profil local sans compte Nixus Cloud garde ces renseignements uniquement sur votre appareil.",
        "account.nixusapp.com utilise un seul témoin essentiel, de première partie, pour vous garder connecté sur ce site. Se connecter ou se déconnecter sur le site du compte est indépendant de votre session dans l'application de bureau. La fonction « Tout supprimer » de l'application de bureau retire la copie locale de votre profil, mais ne supprime pas le profil Nixus Cloud lui-même ; pour le faire supprimer, écrivez à l'adresse indiquée dans la Politique de confidentialité, ce qui est traité manuellement aujourd'hui.",
      ],
    },
    {
      heading: "Comptes et accès premium",
      paragraphs: [
        "Un compte Nixus Cloud est requis pour l'IA hébergée. La capacité d'IA hébergée premium accompagne un forfait Nixus Cloud payant qui la comprend, ou est accordée directement par Nixus. Nixus peut suspendre ou révoquer l'accès à l'IA hébergée, notamment en cas d'abus ou de coûts excessifs.",
      ],
    },
    {
      heading: "Facturation Nixus Cloud",
      paragraphs: [
        "Les abonnements Nixus Cloud sont vendus par l'entremise de Stripe. Stripe est le vendeur officiel : vous achetez, gérez et annulez votre abonnement sur des pages hébergées par Stripe, ouvertes hors de l'application, et c'est Stripe qui est votre contrepartie contractuelle, pas Nixus.",
        "Les remboursements et les litiges passent par Stripe. Stripe peut émettre un remboursement dans les 60 jours suivant un paiement sans avoir besoin de l'accord de Nixus, et Nixus ne prend aucune mesure de son côté en cas de litige, sinon enregistrer l'état d'abonnement qui en résulte.",
        "Les prix sont affichés en dollars canadiens. Si vous êtes à l'extérieur du Canada, vous pourriez être facturé dans votre propre devise au moment du paiement, au taux applicable ce jour-là, et la taxe est comprise dans ce que vous payez. Stripe calcule, perçoit et remet cette taxe, y compris la TPS/TVH au Canada et la TVA dans l'Union européenne ; Nixus ne s'en occupe pas directement.",
        "Passer à un forfait supérieur prend effet immédiatement. Rétrograder ou annuler prend effet à la fin de votre période de facturation en cours, et si un paiement échoue, Stripe le retente selon son propre échéancier pendant que votre abonnement reste actif. Perdre un forfait payant ne supprime jamais vos données : cela désactive seulement la capacité liée à ce forfait.",
      ],
    },
    {
      heading: "Essai gratuit",
      paragraphs: [
        "NixusCloud Advance facturé au mois peut être offert avec un essai gratuit de 7 jours. Une carte de paiement est exigée pour le démarrer, et rien n'est facturé pendant l'essai.",
        "À la fin des 7 jours, l'essai se transforme automatiquement en abonnement payant à NixusCloud Advance mensuel, au prix alors en vigueur, et votre carte est débitée à ce moment-là puis à chaque renouvellement mensuel, jusqu'à ce que vous annuliez. L'essai ne s'applique ni au prix annuel ni à NixusCloud Classic.",
        "Vous pouvez annuler à tout moment avant la fin de l'essai, depuis account.nixusapp.com, et vous ne serez pas facturé. Annuler pendant l'essai conserve vos capacités Advance jusqu'au jour où l'essai devait se terminer, puis ramène le compte au forfait gratuit. Les données conservées sur votre propre ordinateur ne sont pas touchées.",
        "L'essai est prévu comme un seul par personne. Nixus peut refuser ou retirer un essai, notamment s'il s'agit d'un essai répété ou d'une utilisation abusive, et peut modifier ou mettre fin à l'offre pour les nouveaux abonnements à tout moment. Un essai déjà en cours n'est pas touché par une modification de l'offre.",
      ],
    },
    {
      heading: "Ne constitue pas un avis professionnel",
      paragraphs: [
        "Nixus est un outil de suivi. Rien de ce qu'il produit — y compris les catégorisations, conseils ou analyses générés par IA — ne constitue un avis fiscal, juridique, comptable ou en placement. Les réponses de l'IA peuvent être erronées. Il vous incombe de les vérifier avant de vous y fier.",
      ],
    },
    {
      heading: "Vos données et vos sauvegardes",
      paragraphs: [
        "Vos données sont stockées dans une base de données locale sur votre appareil. Nixus n'en conserve aucune copie, sauf si vous activez une fonction optionnelle de Nixus Cloud, qui en stocke une copie comme décrit ci-dessus et dans la Politique de confidentialité. Nixus n'exploite pas de service de sauvegarde et il vous incombe de faire vos propres sauvegardes.",
      ],
    },
    {
      heading: "Garantie et responsabilité",
      paragraphs: [
        "Nixus est en alpha et est fourni « tel quel », sans garantie d'aucune sorte. Dans la mesure maximale permise par la loi, Nixus et son auteur ne sont pas responsables des pertes ou dommages découlant de votre utilisation de l'application, y compris la perte de données ou les décisions prises à partir de réponses de l'IA.",
      ],
    },
    {
      heading: "Modifications",
      paragraphs: [
        "Ces conditions peuvent changer à mesure que le produit évolue. Toute modification importante touchant le traitement de vos données sera reflétée ici et dans la Politique de confidentialité avant la mise en service de la fonction correspondante.",
      ],
    },
  ],
  contactHeading: "Nous joindre",
  contactBody: "Questions concernant ces conditions :",
};

export const PRIVACY_POLICY_FR: LegalDocument = {
  heading: "Politique de confidentialité",
  intro:
    "Nixus est local d'abord : par défaut, vos données financières sont stockées sur votre propre appareil et Nixus n'en conserve aucune copie. Cette politique explique les deux choses qui changent cela, et aucune des deux ne se produit sans que vous la choisissiez : les fonctions IA optionnelles et le stockage Nixus Cloud optionnel.",
  sections: [
    {
      heading: "Ce qui reste sur votre appareil",
      paragraphs: [
        "Budgets, transactions, comptes, revenus, actifs, historique de valeur nette, véhicules et registres d'entretien sont stockés uniquement dans une base de données locale sur votre machine. Aucun compte n'est requis pour les utiliser et il n'y a aucune connexion bancaire. Par défaut, rien n'est téléversé ; les deux exceptions sont les fonctions IA que vous lancez et le stockage Nixus Cloud, qui ne s'applique qu'à un profil connecté à un compte Nixus Cloud. Les identifiants de fournisseur d'IA que vous saisissez sont stockés dans le gestionnaire d'identifiants de votre système d'exploitation, jamais transmis à Nixus.",
      ],
    },
    {
      heading: "Stockage Nixus Cloud optionnel",
      paragraphs: [
        "Certaines fonctions de Nixus Cloud peuvent conserver une copie de vos données dans un espace de stockage infonuagique exploité par Nixus. Elles exigent un compte Nixus Cloud et ne s'appliquent jamais à un profil local : si vous utilisez Nixus sans compte, rien n'est téléversé.",
        "La synchronisation est désactivée pour un profil local, qui est la façon par défaut d'utiliser Nixus et ne demande aucun compte. Lorsque vous vous connectez avec un compte Nixus Cloud dont le forfait comprend la synchronisation, celle-ci est activée automatiquement pour ce profil Cloud et ses données sont copiées vers Nixus Cloud. Vous pouvez la désactiver pour ce profil à tout moment, et vous pouvez continuer d'utiliser un profil local à la place si vous préférez que rien ne soit téléversé.",
        "Cette copie est stockée sur Amazon Web Services, aux États-Unis, et elle est chiffrée en transit et au repos. Elle n'est pas chiffrée de bout en bout : Nixus ne lit pas vos données, mais un administrateur de Nixus ayant accès à ce compte AWS pourrait techniquement le faire, et AWS aussi.",
        "Désactiver une fonction infonuagique arrête les transferts, mais ne supprime pas la copie. Pour la faire supprimer, écrivez à l'adresse au bas de cette page ; les demandes sont traitées manuellement.",
      ],
    },
    {
      heading: "Votre profil Nixus Cloud",
      paragraphs: [
        "Chaque compte Nixus Cloud, y compris les comptes gratuits, possède un profil : prénom et nom, date de naissance, tranche de revenu et sa devise, pays et état, province ou région, ainsi qu'une photo de profil facultative. Il est stocké dans une base de données exploitée par Nixus sur Amazon Web Services, aux États-Unis, associée à votre compte ; il n'est jamais vendu ni partagé, et jamais utilisé à des fins publicitaires.",
        "Vous le modifiez depuis l'application de bureau Nixus ou depuis account.nixusapp.com ; l'enregistrement d'une modification nécessite une connexion Internet dans les deux cas. L'application de bureau conserve une copie en lecture seule sur votre ordinateur afin de pouvoir afficher le profil et fonctionner hors ligne entre les modifications. Les transferts entre votre appareil, le site du compte et les serveurs de Nixus utilisent TLS.",
        "Si vous utilisez Nixus sans compte Nixus Cloud, votre profil reste uniquement sur cet appareil et n'est jamais téléversé. Si vous aviez déjà un profil sur un ordinateur avant l'existence de cette fonction, Nixus vous demande votre accord avant de le téléverser la première fois ; refuser le garde sur cet ordinateur et vous n'êtes plus sollicité par la suite.",
        "La fonction « Tout supprimer » de l'application retire la copie sur cet ordinateur, mais elle ne supprime pas votre profil Nixus Cloud, qui réapparaît à la prochaine connexion, peu importe où. Pour faire supprimer le profil Nixus Cloud lui-même, écrivez à l'adresse au bas de cette page ; cette demande est traitée manuellement aujourd'hui.",
        "account.nixusapp.com utilise un seul témoin essentiel pour vous garder connecté sur ce site. Il est de première partie, ne peut pas être lu par les scripts de la page et n'est envoyé que sur une connexion chiffrée. Se déconnecter du site web ne vous déconnecte pas de l'application de bureau, et se déconnecter de l'application de bureau ne vous déconnecte pas du site web. Ce témoin n'est pas un témoin d'analytique ou de publicité, et aucun n'est ajouté par cette fonction.",
        "Nixus n'enregistre pas les valeurs de votre profil, votre photo, ni aucun jeton ou témoin dans ses journaux. Ce qu'il enregistre pour faire fonctionner le service est votre identifiant de compte, la route appelée, le code de réponse, le temps de traitement et les tailles.",
      ],
    },
    {
      heading: "Paiements Nixus Cloud",
      paragraphs: [
        "Nixus ne stocke aucune donnée de carte, quelle qu'elle soit : ni numéro de carte, ni fragment de carte, ni CVV, ni moyen de paiement brut. Il n'existe aucun chemin par lequel une donnée de carte atteindrait un système de Nixus. Nixus n'affiche aucun champ de carte sur aucune surface ; le paiement et la gestion de l'abonnement se font sur des pages hébergées par Stripe, ouvertes hors de l'application, et Stripe est le processeur de paiement de Nixus.",
        "Ce que Nixus stocke pour la facturation, c'est votre identifiant de compte, votre forfait, l'état de votre abonnement, la date de fin de votre période de facturation en cours, et les identifiants de client et d'abonnement que Stripe vous attribue. Cela sert à accorder les capacités comprises dans votre forfait et à vous accompagner en cas de problème.",
        "Stripe conserve tout le reste au sujet de votre paiement : vos coordonnées de carte, votre adresse de facturation et votre historique de paiement. Les modalités de confidentialité de Stripe, et non celles-ci, régissent ce qu'il conserve et pour combien de temps.",
        "Nixus ne vend ni ne partage jamais vos données de facturation et ne les utilise jamais à des fins publicitaires.",
      ],
    },
    {
      heading: "Ce qui quitte votre appareil, et quand",
      paragraphs: [
        "Uniquement lorsque vous lancez une fonction IA. Il n'y a aucune transmission en arrière-plan. À ce moment, le contenu de cette seule requête quitte votre appareil. Selon votre configuration, ce contenu se rend à l'un de deux endroits.",
      ],
    },
    {
      heading: "Votre propre fournisseur d'IA",
      paragraphs: [
        "Par défaut, la requête va directement de votre appareil au fournisseur que vous avez configuré — AWS Bedrock ou OpenAI — avec vos propres identifiants. L'infrastructure de Nixus n'est pas sur ce chemin et ne peut pas voir la requête. Les conditions de confidentialité de ce fournisseur s'appliquent.",
      ],
    },
    {
      heading: "IA hébergée Nixus Cloud premium",
      paragraphs: [
        "Si l'IA hébergée premium est activée sur votre compte, vos requêtes financières et toute image ou tout PDF de relevé téléversé sont transmis par l'infrastructure de Nixus vers Amazon Bedrock, exploité par Amazon Web Services, pour traitement.",
        "Notez quel chemin emprunte une requête. Avec un compte premium, une requête admissible passe par Nixus vers Amazon Bedrock même si vous avez saisi vos propres identifiants AWS ou OpenAI, et aucun réglage dans l'application ne permet de privilégier votre propre fournisseur. Vos identifiants ne servent que si l'IA hébergée est indisponible, à court de quota, ou non activée sur votre compte. Si vous préférez que chaque requête aille directement à votre propre fournisseur, demandez-nous de désactiver l'IA hébergée premium sur votre compte.",
        "Nixus ne stocke ni la requête, ni le relevé joint, ni la réponse du modèle, ni le nom du fichier dans ses propres bases de données ou journaux. Le contenu des requêtes n'existe dans les systèmes de Nixus qu'en mémoire, pour la durée de cette seule requête.",
      ],
    },
    {
      heading: "Deux limites à cette garantie",
      paragraphs: [
        "La garantie de non-conservation ci-dessus ne couvre que les systèmes contrôlés par Nixus. Elle n'engage pas Amazon Web Services. AWS peut traiter et, selon les conditions de Bedrock et ses politiques de détection d'abus, conserver le contenu des requêtes. Nixus ne contrôle pas et ne peut pas outrepasser cela.",
        "L'IA hébergée utilise un profil d'inférence Amazon Bedrock interrégional limité aux États-Unis ; une requête donnée peut donc être traitée dans n'importe quelle région AWS américaine et n'est pas confinée à une seule. Ce traitement peut se trouver à l'extérieur de votre pays de résidence, et les conditions d'AWS pour la région de traitement s'y appliquent.",
      ],
    },
    {
      heading: "Quota de requêtes et repli",
      paragraphs: [
        "L'IA hébergée est soumise à un quota mensuel de requêtes. Lorsqu'il est épuisé, que le service est indisponible ou désactivé, Nixus se replie sur le fournisseur d'IA que vous avez configuré vous-même lorsque celui-ci prend la fonction en charge, et signale une erreur autrement. Vos données et le reste de l'application ne sont pas touchés.",
      ],
    },
    {
      heading: "Aucune vente de renseignements personnels",
      paragraphs: [
        "Nixus ne vend pas vos renseignements personnels et n'utilise pas votre contenu financier pour entraîner des modèles.",
      ],
    },
    {
      heading: "Analytique du site web",
      paragraphs: [
        "Ce site web marketing utilise une analytique agrégée respectueuse de la vie privée et n'a accès à aucune donnée de l'application de bureau.",
      ],
    },
  ],
  contactHeading: "Nous joindre",
  contactBody: "Questions sur cette politique, ou demande concernant vos données :",
};
