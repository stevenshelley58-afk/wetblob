#!/usr/bin/env node
/**
 * List latest items from the lake
 * 
 * Usage:
 *   pnpm lake:list [options]
 *   
 * Options:
 *   --type <type>    Filter by item type (default: all)
 *   --limit <n>      Number of items to show (default: 20)
 *   --help           Show help
 */

import { createDb, listItems, getBlob } from '@wetblob/lake-db';
import type { Item } from '@wetblob/lake-db';

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function shortId(id: string): string {
  return id.slice(0, 8) + '...';
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

async function getExcerpt(item: Item, db: ReturnType<typeof createDb>): Promise<string> {
  if (item.text_content) {
    return truncate(item.text_content.replace(/\s+/g, ' ').trim(), 60);
  }
  if (item.blob_id) {
    return '[blob]';
  }
  return '[no content]';
}

function showHelp() {
  console.log(`
Usage: pnpm lake:list [options]

List latest items from the lake storage.

Options:
  --type <type>    Filter by item type (e.g., intel.webpage)
  --limit <n>      Number of items to show (default: 20)
  --help           Show this help message

Environment:
  DATABASE_URL     PostgreSQL connection string (required)
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse args
  let type: string | undefined;
  let limit = 20;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
    
    if (arg === '--type' && i + 1 < args.length) {
      type = args[++i];
    } else if (arg === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit) || limit < 1) {
        console.error('Invalid limit value');
        process.exit(1);
      }
    }
  }
  
  // Create DB connection
  const db = createDb();
  
  try {
    const items = await listItems(db, { type, limit });
    
    if (items.length === 0) {
      console.log('No items found.');
      return;
    }
    
    // Print header
    console.log(`${'ITEM_ID'.padEnd(12)} ${'TYPE'.padEnd(20)} ${'OBSERVED_AT'.padEnd(20)} EXCERPT`);
    console.log('-'.repeat(100));
    
    // Print items
    for (const item of items) {
      const excerpt = await getExcerpt(item, db);
      const observedAt = item.observed_at ? formatDate(item.observed_at) : 'N/A';
      
      console.log(
        `${shortId(item.item_id).padEnd(12)} ` +
        `${item.type.padEnd(20)} ` +
        `${observedAt.padEnd(20)} ` +
        `${excerpt}`
      );
    }
    
    console.log(`\nShowing ${items.length} item(s)`);
    
  } catch (error) {
    console.error('Failed to list items:', error);
    process.exit(1);
  } finally {
    await db.$pool.end();
  }
}

main();