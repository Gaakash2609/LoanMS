using Microsoft.AspNetCore.DataProtection.Repositories;
using Npgsql;
using System.Xml.Linq;

namespace LoanMS.API;

/// <summary>
/// Persists the Data Protection key-ring to the existing "AppSettings"
/// table in PostgreSQL/RDS, instead of the local container filesystem.
///
/// Why this exists: the original setup used
/// .PersistKeysToFileSystem(ContentRootPath/"dataprotection-keys"), with a
/// comment explicitly reasoning "MUST persist keys to disk, in the same
/// place the SQLite DB already lives... so it survives every
/// restart/redeploy exactly as reliably as the DB does." That reasoning
/// held for SQLite (a single local file) but does NOT hold once the app
/// runs on ECS Fargate against PostgreSQL/RDS — an ECS task's local disk
/// is wiped on every redeploy/restart/scaling event, while RDS is a
/// genuinely separate, durable store. Every redeploy therefore generated a
/// brand-new, ephemeral key ring; anything encrypted with the previous
/// ring (Gemini/OpenAI AI keys, Gmail SMTP password, InCred client secret
/// — all saved via Settings using this same Data Protection instance)
/// silently failed to decrypt afterward and appeared to have "vanished",
/// even though the encrypted value was still sitting in the database
/// completely intact.
///
/// Raw Npgsql (no EF Core DbContext) is used deliberately — Data
/// Protection is wired up very early in Program.cs, before AppDbContext's
/// own service registration, so this avoids any startup-ordering
/// dependency on the DI container being fully built yet.
/// </summary>
public class PostgresXmlRepository : IXmlRepository
{
    private readonly string _connectionString;
    private const string KeyPrefix = "dataprotection_key_";

    public PostgresXmlRepository(string connectionString)
    {
        _connectionString = connectionString;
        EnsureTableExists();
    }

    // AppSettings already exists (created by the app's own EF Core
    // migrations) by the time this constructor could plausibly run in a
    // real deployment, but this is a harmless no-op safety net in case
    // Data Protection is ever initialized before migrations have run.
    private void EnsureTableExists()
    {
        try
        {
            using var conn = new NpgsqlConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                CREATE TABLE IF NOT EXISTS ""AppSettings"" (
                    ""Id"" SERIAL PRIMARY KEY,
                    ""Key"" character varying(200) NOT NULL,
                    ""Value"" text NOT NULL,
                    ""Category"" character varying(100),
                    ""UserId"" integer,
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""UpdatedAt"" timestamp with time zone,
                    ""IsDeleted"" boolean NOT NULL DEFAULT false
                );";
            cmd.ExecuteNonQuery();
        }
        catch
        {
            // If this fails, StoreElement/GetAllElements below will also
            // fail loudly and Data Protection's own error handling takes
            // over — no silent fallback here.
        }
    }

    public IReadOnlyCollection<XElement> GetAllElements()
    {
        var elements = new List<XElement>();
        using var conn = new NpgsqlConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT \"Value\" FROM \"AppSettings\" WHERE \"Key\" LIKE @prefix AND \"IsDeleted\" = false";
        cmd.Parameters.AddWithValue("prefix", KeyPrefix + "%");
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            try { elements.Add(XElement.Parse(reader.GetString(0))); }
            catch { /* skip a corrupt row rather than fail the whole key-ring load */ }
        }
        return elements;
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        var key = KeyPrefix + (string.IsNullOrWhiteSpace(friendlyName) ? Guid.NewGuid().ToString("N") : friendlyName);
        var xml = element.ToString(SaveOptions.DisableFormatting);

        using var conn = new NpgsqlConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO ""AppSettings"" (""Key"", ""Value"", ""Category"", ""CreatedAt"", ""IsDeleted"")
            VALUES (@key, @val, 'dataprotection', now(), false)
            ON CONFLICT DO NOTHING;";
        // No unique constraint on Key exists for this table, so a plain
        // upsert-by-key isn't available — Data Protection calls
        // StoreElement once per NEW key it generates (not on every
        // request), and each key gets a unique friendlyName (its Guid), so
        // a straight INSERT is the correct, safe behavior here.
        cmd.Parameters.AddWithValue("key", key);
        cmd.Parameters.AddWithValue("val", xml);
        cmd.ExecuteNonQuery();
    }
}
