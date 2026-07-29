using System.Runtime.CompilerServices;

// Lets LoanMS.Tests call IncredController's internal (not public) mapping
// helpers and token-cache types directly for unit testing. Grants no other
// assembly any access, and doesn't change runtime behavior for anything else.
[assembly: InternalsVisibleTo("LoanMS.Tests")]
