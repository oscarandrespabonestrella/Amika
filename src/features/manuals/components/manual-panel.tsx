import { listSuggestions } from "../services/manual-store";
import { ManualSearch } from "./manual-search";
import { SavedManualsList } from "./saved-manuals-list";
import { SuggestionsList } from "./suggestions-list";

type Props = {
  gameId: string;
  gameName: string;
  userId: string;
  isAdmin: boolean;
};

/**
 * Everything about manuals that sits with a game's rules: the search button, the proposals
 * waiting for review, and the PDFs saved on this device. Rendered by the page into the Game
 * Center's rules section (the game-center module never imports this one).
 */
export async function ManualPanel({
  gameId,
  gameName,
  userId,
  isAdmin,
}: Props) {
  const suggestions = await listSuggestions(gameId, userId);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <ManualSearch gameId={gameId} gameName={gameName} isAdmin={isAdmin} />
      </div>
      <SuggestionsList
        items={isAdmin ? suggestions : suggestions.filter((s) => s.mine)}
        isAdmin={isAdmin}
      />
      <SavedManualsList gameId={gameId} />
    </div>
  );
}
