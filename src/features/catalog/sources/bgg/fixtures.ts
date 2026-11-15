/**
 * Hand-written samples that follow the documented shape of BGG's XML API2
 * responses. They are NOT recorded from the live API (no token yet): re-check
 * against real responses when the token arrives (see bgg.contract.test.ts).
 */

export const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="3" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13">
    <name type="primary" value="CATAN" />
    <yearpublished value="1995" />
  </item>
  <item type="boardgameexpansion" id="926">
    <name type="primary" value="CATAN: Seafarers" />
    <yearpublished value="1997" />
  </item>
  <item type="boardgame" id="9999">
    <name type="alternate" value="Siedler" />
    <name type="primary" value="Untitled &amp; Co" />
  </item>
</items>`;

export const EMPTY_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="0" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"></items>`;

export const THING_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13">
    <thumbnail>https://cf.geekdo-images.com/thumb.jpg</thumbnail>
    <image>https://cf.geekdo-images.com/full.jpg</image>
    <name type="primary" sortindex="1" value="CATAN" />
    <name type="alternate" sortindex="1" value="Die Siedler von Catan" />
    <description>Picture yourself in the era of discoveries:&amp;#10;&amp;#10;Trade &amp;amp; build. &amp;quot;Quoted&amp;quot; &amp;mdash; caf&amp;eacute;.</description>
    <yearpublished value="1995" />
    <minplayers value="3" />
    <maxplayers value="4" />
    <playingtime value="120" />
    <minplaytime value="60" />
    <maxplaytime value="120" />
    <minage value="10" />
    <link type="boardgamecategory" id="1021" value="Economic" />
    <link type="boardgamecategory" id="1026" value="Negotiation" />
    <link type="boardgamemechanic" id="2072" value="Dice Rolling" />
    <link type="boardgamefamily" id="70" value="Some family" />
    <link type="boardgamedesigner" id="11" value="Klaus Teuber" />
    <link type="boardgamepublisher" id="37" value="KOSMOS" />
    <link type="boardgameexpansion" id="926" value="CATAN: Seafarers" />
    <link type="boardgameexpansion" id="27" value="Some Base" inbound="true" />
  </item>
</items>`;

export const EXPANSION_XML = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgameexpansion" id="926">
    <image>https://cf.geekdo-images.com/exp.jpg</image>
    <name type="primary" value="CATAN: Seafarers" />
    <description>Sail the seas.</description>
    <yearpublished value="1997" />
    <minplayers value="3" /><maxplayers value="4" />
    <minplaytime value="0" /><maxplaytime value="0" />
    <minage value="0" />
    <link type="boardgameexpansion" id="13" value="CATAN" inbound="true" />
  </item>
</items>`;

/** Inconsistent source data we must not pass on to the database CHECKs. */
export const MESSY_XML = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="55">
    <image>http://insecure.example.com/x.jpg</image>
    <name type="primary" value="Messy" />
    <yearpublished value="0" />
    <minplayers value="5" /><maxplayers value="2" />
    <minplaytime value="90" /><maxplaytime value="30" />
    <minage value="abc" />
  </item>
</items>`;

export const ERROR_XML = `<?xml version="1.0" encoding="utf-8"?>
<errors><error><message>Invalid request</message></error></errors>`;
