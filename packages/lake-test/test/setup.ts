import { config } from 'dotenv';
import { join } from 'path';

// Load .env from project root (2 levels up from packages/lake-test)
config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '..', '.env') });
