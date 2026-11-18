"use client";

import { DownloadLink } from "./download-link";
import { fileUrl } from "./format";
import { SaveOfflineButton } from "./save-offline-button";

type Props = {
  resourceId: string;
  url: string;
  gameId: string;
  gameName: string;
  title: string;
  locale: string | null;
  publisher: string | null;
};

/** Download and "save for offline" for a rulebook that is already in the Game Center. */
export function RuleFileActions({ resourceId, ...manual }: Props) {
  return (
    <>
      <DownloadLink href={fileUrl.resource(resourceId)} />
      <SaveOfflineButton {...manual} source={fileUrl.resource(resourceId)} />
    </>
  );
}
