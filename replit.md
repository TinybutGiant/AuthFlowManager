# Overview

This is a role-based admin panel application built with React, Express, and PostgreSQL. The system provides comprehensive user management with hierarchical admin roles (super_admin, admin_finance, admin_verifier, admin_support) and an approval workflow for admin operations. The application integrates Replit's authentication system for secure user login and session management.

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
- **Authentication**: Replit's OpenID Connect (OIDC) integration with Passport.js
- **Session Management**: Express sessions stored in PostgreSQL with connect-pg-simple

## Database Design
- **ORM**: Drizzle with PostgreSQL dialect for schema definition and migrations
- **Schema Structure**: 
  - `users` table for Replit user data (mandatory for auth)
  - `sessions` table for session storage (mandatory for auth)
  - `adminUsers` table for admin-specific data with role and status fields
  - `adminUserApprovals` table for approval workflow management
- **Role System**: Enum-based admin roles with hierarchical permissions

## Authentication & Authorization
- **Authentication**: Replit OIDC integration for secure login/logout
- **Session Storage**: PostgreSQL-backed sessions with configurable TTL
- **Authorization**: Role-based middleware with route protection
- **User Flow**: Replit users mapped to admin roles through email association

## API Design
- **Architecture**: RESTful API with Express.js
- **Route Protection**: Middleware-based role checking with fine-grained permissions
- **Error Handling**: Centralized error handling with proper HTTP status codes
- **Request/Response**: JSON-based communication with TypeScript interfaces

## Frontend-Backend Integration
- **API Client**: Custom fetch wrapper with credential handling and error management
- **Query Management**: TanStack Query for caching, background updates, and optimistic updates
- **Route Protection**: Client-side route guards that verify user authentication and role permissions

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL database hosting with connection pooling
- **Database URL**: Environment-based configuration for database connectivity

## Authentication Services
- **Replit Authentication**: OpenID Connect provider for user authentication
- **Session Store**: PostgreSQL-based session persistence with automatic cleanup

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