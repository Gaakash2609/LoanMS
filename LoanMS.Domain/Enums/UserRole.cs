namespace LoanMS.Domain.Enums;

public enum UserRole
{
    Admin = 0,
    Manager = 1,
    Sales = 2,
    Dsa = 3,
    Partner = 4,
    // Added — the frontend's user-management form (twSaveUser) already
    // offers these roles (ROLES config in efin-app.js), but the backend
    // enum had no matching value, so any user created/edited with one of
    // these roles could never actually be saved to the database.
    LoginTeam = 5,
    TeamLeader = 6,
    Accounts = 7,
    LocationHead = 8,
    OperationManager = 9,
    ProductTeam = 10
}
