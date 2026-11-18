// Publishers whose own websites host rulebooks. A result on one of these domains is
// "official"; the first domain of each entry is the one we search with `site:`.
// Only domains we are sure belong to the publisher belong here: a wrong entry would
// label somebody else's file as official.

type Publisher = {
  name: string;
  /** Lower-case fragments that identify the publisher in a catalog term. */
  aliases: string[];
  domains: string[];
};

export const PUBLISHERS: Publisher[] = [
  { name: "Devir", aliases: ["devir"], domains: ["devir.com"] },
  {
    name: "Asmodee",
    aliases: ["asmodee"],
    domains: [
      "asmodee.com",
      "asmodee.es",
      "asmodee.fr",
      "asmodee.de",
      "asmodee.net",
      "asmodee.co.uk",
      "asmodee.us",
    ],
  },
  {
    name: "Ravensburger",
    aliases: ["ravensburger"],
    domains: [
      "ravensburger.com",
      "ravensburger.de",
      "ravensburger.fr",
      "ravensburger.es",
      "ravensburger.org",
    ],
  },
  {
    name: "Hasbro",
    aliases: ["hasbro", "avalon hill", "wizards of the coast"],
    domains: ["hasbro.com"],
  },
  {
    name: "Fantasy Flight Games",
    aliases: ["fantasy flight"],
    domains: ["fantasyflightgames.com"],
  },
  {
    name: "Z-Man Games",
    aliases: ["z-man", "zman"],
    domains: ["zmangames.com"],
  },
  {
    name: "Days of Wonder",
    aliases: ["days of wonder"],
    domains: ["daysofwonder.com"],
  },
  { name: "Repos Production", aliases: ["repos"], domains: ["rprod.com"] },
  { name: "Kosmos", aliases: ["kosmos"], domains: ["kosmos.de"] },
  {
    name: "Hans im Glück",
    aliases: ["hans im gl"],
    domains: ["hans-im-glueck.de"],
  },
  {
    name: "Stonemaier Games",
    aliases: ["stonemaier"],
    domains: ["stonemaiergames.com"],
  },
  {
    name: "Cephalofair Games",
    aliases: ["cephalofair"],
    domains: ["cephalofair.com"],
  },
  {
    name: "Czech Games Edition",
    aliases: ["czech games"],
    domains: ["czechgames.com"],
  },
  {
    name: "Plaid Hat Games",
    aliases: ["plaid hat"],
    domains: ["plaidhatgames.com"],
  },
  { name: "Gigamic", aliases: ["gigamic"], domains: ["gigamic.com"] },
  { name: "IELLO", aliases: ["iello"], domains: ["iello.com", "iello.fr"] },
  { name: "Libellud", aliases: ["libellud"], domains: ["libellud.com"] },
  {
    name: "Space Cowboys",
    aliases: ["space cowboys"],
    domains: ["spacecowboys.fr"],
  },
  {
    name: "Blue Orange Games",
    aliases: ["blue orange"],
    domains: ["blueorangegames.com"],
  },
  {
    name: "Queen Games",
    aliases: ["queen games"],
    domains: ["queen-games.com"],
  },
  { name: "Pegasus Spiele", aliases: ["pegasus"], domains: ["pegasus.de"] },
  {
    name: "Lookout Games",
    aliases: ["lookout"],
    domains: ["lookout-spiele.de"],
  },
  {
    name: "Maldito Games",
    aliases: ["maldito"],
    domains: ["malditogames.com"],
  },
  {
    name: "Tranjis Games",
    aliases: ["tranjis"],
    domains: ["tranjisgames.com"],
  },
  { name: "Gen X Games", aliases: ["gen x"], domains: ["genxgames.es"] },
  {
    name: "Hachette Boardgames",
    aliases: ["hachette"],
    domains: ["hachetteboardgames.com"],
  },
  { name: "Mattel", aliases: ["mattel"], domains: ["mattel.com"] },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The publisher that owns this host, or null. */
export function publisherForHost(host: string): string | null {
  const h = host.toLowerCase();
  return (
    PUBLISHERS.find((p) => p.domains.some((d) => hostMatches(h, d)))?.name ??
    null
  );
}

/** Known publishers among the catalog's publisher terms of a game. */
export function knownPublishers(termNames: string[]): Publisher[] {
  const wanted = termNames.map((n) => n.toLowerCase());
  return PUBLISHERS.filter((p) =>
    p.aliases.some((alias) => wanted.some((name) => name.includes(alias))),
  );
}
