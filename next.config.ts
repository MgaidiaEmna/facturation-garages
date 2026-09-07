import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Téléversement des logos : le bucket accepte 2 Mio par fichier, la
       * limite par défaut des Server Actions est de 1 Mo. Un logo de 1,5 Mo
       * était donc refusé par Next AVANT d'atteindre la moindre validation —
       * et pas proprement : une page d'erreur brute, à un endroit où rien
       * n'était censé mal se passer.
       *
       * 3 Mo laisse la marge que la documentation réclame : la limite porte
       * sur le corps HTTP BRUT, bornes multipart et en-têtes de parties
       * compris, pas sur la taille du fichier. Avec cette marge, c'est le
       * bucket (`file_size_limit`) qui redevient la seule autorité sur la
       * taille d'un logo — une seule règle, à un seul endroit.
       *
       * La borne reste basse à dessein : elle protège contre l'envoi de
       * charges utiles massives, ce pour quoi Next la pose.
       */
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
