import { db } from "./knex";

async function main() {
  const [batchNo, migrations] = await db.migrate.rollback();

  console.log(`Database rollback completed. Batch: ${batchNo}`);

  if (migrations.length === 0) {
    console.log("No migrations were rolled back.");
  } else {
    console.log("Rolled back migrations:");
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