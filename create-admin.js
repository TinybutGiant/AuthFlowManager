
const bcrypt = require('bcrypt');
const { db } = require('./server/db');
const { adminUsers } = require('./shared/schema');

async function createTestAdmin() {
  try {
    const email = 'suzy2ming@gmail.com';
    const password = '123456asdf';
    const name = 'Test Super Admin';
    
    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create admin user
    const [newAdmin] = await db
      .insert(adminUsers)
      .values({
        name,
        email,
        role: 'super_admin',
        status: 'active',
        passwordHash,
        permissions: ['*'],
      })
      .returning();
    
    console.log('Created admin user:', {
      id: newAdmin.id,
      email: newAdmin.email,
      name: newAdmin.name,
      role: newAdmin.role,
      status: newAdmin.status
    });
    
    console.log('Login credentials:');
    console.log('Email:', email);
    console.log('Password:', password);
    
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    process.exit(0);
  }
}

createTestAdmin();
