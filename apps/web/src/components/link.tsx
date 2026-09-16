"use client";

import NextLink from "next/link";
import {
  Link as ReactAriaLink,
  type LinkProps as ReactAriaLinkProps,
} from "react-aria-components/Link";

type LinkProps = Omit<ReactAriaLinkProps, "href" | "render"> & {
  href: string;
};

export function Link(props: LinkProps) {
  return (
    <ReactAriaLink
      {...props}
      render={(linkProps) => {
        if (!("href" in linkProps) || typeof linkProps.href !== "string") {
          return <span {...linkProps} />;
        }

        const { href, onClick, onMouseEnter, onTouchStart, ...anchorProps } = linkProps;

        return (
          <NextLink
            {...anchorProps}
            {...(onClick === undefined ? {} : { onClick })}
            {...(onMouseEnter === undefined ? {} : { onMouseEnter })}
            {...(onTouchStart === undefined ? {} : { onTouchStart })}
            href={href}
          />
        );
      }}
    />
  );
}
