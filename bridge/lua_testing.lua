-- snippets for lua unit tests

local function make_ram(size, init)
	size = size or 0x10000 -- 64KB default
	local ram = { size = size, mem = {} }

	-- init: nil -> 0, or a number 0..255
	local initv = init or 0
	if initv ~= 0 then
		for i = 0, size - 1 do
			ram.mem[i] = initv
		end
	end

	function ram:peek(addr)
		if addr < 0 or addr >= self.size then
			error("peek OOB: " .. addr)
		end
		return self.mem[addr] or 0
	end

	function ram:poke(addr, v)
		if addr < 0 or addr >= self.size then
			error("poke OOB: " .. addr)
		end
		self.mem[addr] = v & 0xFF
	end

	function ram:clear(v)
		v = (v or 0) & 0xFF
		self.mem = {}
		if v ~= 0 then
			for i = 0, self.size - 1 do
				self.mem[i] = v
			end
		end
	end

	-- handy helpers for tests
	function ram:poke_bytes(addr, bytes)
		for i = 1, #bytes do
			self:poke(addr + (i - 1), bytes[i])
		end
	end

	function ram:peek_bytes(addr, n)
		local out = {}
		for i = 0, n - 1 do
			out[#out + 1] = self:peek(addr + i)
		end
		return out
	end

	return ram
end

-- dump table
function tprint(tbl, indent)
	if not indent then
		indent = 2
	end
	for k, v in pairs(tbl) do
		formatting = string.rep("  ", indent) .. k .. ": "
		if type(v) == "table" then
			print(formatting)
			tprint(v, indent + 1)
		elseif type(v) == "boolean" then
			print(formatting .. tostring(v))
		else
			print(formatting .. v)
		end
	end
end

local ram = make_ram()
local peek, poke = function(a)
	return ram:peek(a)
end, function(a, v)
	ram:poke(a, v)
end
