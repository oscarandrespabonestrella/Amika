"use client";

import { useState } from "react";

const TAG_LIMIT = 4;

type Props = {
  title: string;
  description: string | null;
  emptyText: string;
  tags: readonly string[];
  readMore: string;
  readLess: string;
};

/** "About": the description clamped to a few lines with "Read more", plus the game's tags as pills. */
export function AboutSection({
  title,
  description,
  emptyText,
  tags,
  readMore,
  readLess,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [allTags, setAllTags] = useState(false);
  // Long enough to be clamped; short descriptions don't need the toggle.
  const long = (description?.length ?? 0) > 220;
  const shown = allTags ? tags : tags.slice(0, TAG_LIMIT);
  const hidden = tags.length - shown.length;

  return (
    <section aria-labelledby="description-title" className="flex flex-col gap-2">
      <h2 id="description-title" className="text-base font-semibold">
        {title}
      </h2>
      {description ? (
        // Plain text only (never HTML): React escapes it, newlines are preserved.
        <p
          className={`max-w-prose text-[15px] leading-relaxed text-pretty whitespace-pre-line text-foreground/85 ${
            long && !expanded ? "line-clamp-4" : ""
          }`}
        >
          {description}
        </p>
      ) : (
        <p className="text-muted-foreground">{emptyText}</p>
      )}
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="min-h-9 w-fit text-sm font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {expanded ? readLess : readMore}
        </button>
      )}
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((tag) => (
            <li
              key={tag}
              className="inline-flex h-[30px] items-center rounded-full bg-muted px-2.5 text-[13px] text-foreground/80"
            >
              {tag}
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setAllTags(true)}
                className="inline-flex h-[30px] items-center rounded-full px-2.5 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                +{hidden}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
