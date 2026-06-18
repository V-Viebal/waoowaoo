/**
 * 管理员账号初始化脚本
 * 使用方法: npx tsx --env-file=.env scripts/create-admin.ts <用户名> <密码>
 * 示例: npx tsx --env-file=.env scripts/create-admin.ts admin password123
 */
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

async function createAdmin() {
  const args = process.argv.slice(2)
  const [name, password] = args

  if (!name || !password) {
    console.error('❌ 请提供用户名和密码')
    console.error('使用方法: npx tsx --env-file=.env scripts/create-admin.ts <用户名> <密码>')
    process.exit(1)
  }

  if (password.length < 6) {
    console.error('❌ 密码长度至少为6位')
    process.exit(1)
  }

  try {
    // 检查用户是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { name }
    })

    if (existingUser) {
      console.log(`⚠️  用户 ${name} 已存在，将更新为管理员角色`)
      const updatedUser = await prisma.user.update({
        where: { name },
        data: { role: 'admin' },
        select: { id: true, name: true, role: true }
      })
      console.log('✅ 管理员账号更新成功:')
      console.log(`   用户名: ${updatedUser.name}`)
      console.log(`   角色: ${updatedUser.role}`)
    } else {
      // 哈希密码
      const hashedPassword = await bcrypt.hash(password, 12)

      // 创建管理员用户（事务）
      const user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name,
            password: hashedPassword,
            role: 'admin'
          }
        })

        // 创建用户余额记录
        await tx.userBalance.create({
          data: {
            userId: newUser.id,
            balance: 0,
            frozenAmount: 0,
            totalSpent: 0
          }
        })

        return newUser
      })

      console.log('✅ 管理员账号创建成功:')
      console.log(`   用户名: ${user.name}`)
      console.log(`   角色: admin`)
    }

    await prisma.$disconnect()
    process.exit(0)
  } catch (error) {
    console.error('❌ 创建管理员账号失败:', error)
    await prisma.$disconnect()
    process.exit(1)
  }
}

createAdmin()
