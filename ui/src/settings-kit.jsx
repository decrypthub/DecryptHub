import React from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
export function Section({ title, desc, children, actions }) {
  return (
    <section className="sec">
      <Flex align="center" gap="2" mb="2">
        <Text size="3" weight="bold">
          {title}
        </Text>
        <Box flexGrow="1" />
        {actions}
      </Flex>
      {desc && (
        <Text as="div" size="1" color="gray" mb="2" style={{ lineHeight: 1.7 }}>
          {desc}
        </Text>
      )}
      {children}
    </section>
  );
}

export function Row({ label, desc, children }) {
  return (
    <div className="field-row">
      <div className="field-label">
        <Text size="2">{label}</Text>
        {desc && (
          <Text as="div" size="1" color="gray" style={{ lineHeight: 1.6 }}>
            {desc}
          </Text>
        )}
      </div>
      <div className="field-ctl">{children}</div>
    </div>
  );
}
