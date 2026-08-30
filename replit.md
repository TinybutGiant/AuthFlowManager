# Overview

This is a role-based admin panel application built with React, Express, and PostgreSQL. The system provides admin user management with hierarchical admin roles (super_admin, admin_finance, admin_verifier, admin_support), approval workflows for admin operations, internal Finance/AP tools for small-company vendor, subscription, bill, payment application, and reconciliation workflows, super-admin-only Payroll and Tax record/control-plane tools, and internal Personnel tools for worker, employment, compensation, payroll participation setup, and Work Authorization tracking. Authentication uses JWT bearer tokens issued by the app.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **Routing**: Wouter for client-side routing with role-based protected routes
- **UI Framework**: shadcn/ui components built on Radix UI primitives with Tailwind CSS
- **State Management**: TanStack Query for server state and API interactions
- **Form Handling**: React Hook Form with Zod validation for type-safe form management

## Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Authentication**: App-issued JWT bearer tokens
- **Session Management**: Client stores the bearer token and sends it in the `Authorization` header

## Database Design
- **ORM**: Drizzle with PostgreSQL dialect for schema definition and migrations
- **Schema Structure**: 
  - `adminUsers` table for admin-specific data with role and status fields
  - `adminUserApprovals` table for approval workflow management
  - Finance foundation tables for legal entities, vendors, recurring expenses, vendor bills, expense payments, bill applications, documents, external references, finance audit events, payroll audit events, tax audit events, and reconciliation exceptions
  - Personnel foundation tables for workers, employments, compensation terms, work authorizations, and personnel audit events
- **Role System**: Enum-based admin roles with hierarchical permissions

## Authentication & Authorization
- **Authentication**: JWT bearer tokens returned by the login endpoint
- **Session Storage**: No server-side browser cookie session is used for admin API authentication
- **Authorization**: Role-based middleware with route protection
- **User Flow**: Admin users authenticate with email/password and are authorized through role checks

## API Design
- **Architecture**: RESTful API with Express.js
- **Route Protection**: Middleware-based role checking with fine-grained permissions
- **Error Handling**: Centralized error handling with proper HTTP status codes
- **Request/Response**: JSON-based communication with TypeScript interfaces
- **Internal Finance/AP Routes**: Admin Finance APIs expose vendors, subscriptions, bills, payments, bill applications, and AP-only reconciliation exceptions through deliberate DTOs.
- **Internal Payroll Routes**: Super-admin-only Payroll APIs expose payroll runs, worker result snapshots, controlled result lines, employee payment records, lifecycle transitions, correction runs, and external references. Payroll stores externally calculated or manually entered payroll facts; correction runs are replacement snapshots in a single successor chain, overview totals use effective finalized snapshots, and settled paid amounts come from cleared payments only. Payroll does not calculate payroll, execute ACH, or generate Tax-domain liabilities/payments/filings.
- **Internal Personnel Routes**: Admin Personnel APIs expose workers, employment records, compensation terms, payroll participation setup, and super-admin-only Work Authorization tracking through deliberate DTOs.
- **Internal Tax Routes**: Super-admin-only Tax APIs expose agencies, legal-entity registrations, recognized liability facts, adjustments, agency payments, payment allocations, tax-scoped reconciliation exceptions, filings, amendments, and external references through deliberate DTOs. Tax records externally calculated or manually entered tax facts; cleared agency payment allocations drive derived settlement, while submitted allocations remain in flight. Tax does not calculate payroll tax, generate liabilities from Payroll, sync providers, ingest bank feeds, or file returns electronically.
- **Migration Gate**: Local commits may be made after static and unit verification, but the migration chain through the latest Finance/Personnel/Payroll/Tax migration must be applied on disposable or staging PostgreSQL before any production migration.

## Frontend-Backend Integration
- **API Client**: Custom fetch wrapper with bearer-token handling and error management
- **Query Management**: TanStack Query for caching, background updates, and optimistic updates
- **Route Protection**: Client-side route guards that verify user authentication and role permissions

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL database hosting with connection pooling
- **Database URL**: Environment-based configuration for database connectivity

## Authentication Services
- **JWT Secret**: Environment-based JWT signing secret

## Development Tools
- **Vite**: Development server and build tool with HMR support
- **Replit Integration**: Development banner and cartographer plugin for Replit environment
- **TypeScript**: Full-stack type safety with shared schema definitions

## UI Libraries
- **Radix UI**: Headless component primitives for accessible UI components
- **Tailwind CSS**: Utility-first CSS framework with design system integration
- **Lucide React**: Icon library for consistent iconography

## Utility Libraries
- **Zod**: Schema validation for forms and API data
- **bcrypt**: Password hashing for admin credentials
- **date-fns**: Date manipulation and formatting utilities
