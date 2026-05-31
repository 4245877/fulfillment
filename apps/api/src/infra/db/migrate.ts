import { db } from "./knex";

async function main() {
  const [batchNo, migrations] = await db.migrate.latest();

  console.log(`Database migrated. Batch: ${batchNo}`);

  if (migrations.length === 0) {
    console.log("No new migrations.");
  } else {
    console.log("Applied migrations:");
    for (const migration of migrations) {
      console.log(`- ${migration}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });