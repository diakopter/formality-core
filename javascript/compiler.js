const {Var, App, Lam, Num, Op1, Op2, gen_name} = require("./core.js");
const {Net, Pointer, Numeric, addr_of, slot_of, type_of, numb_of, NOD, OP1, OP2, NUM, PTR} = require("./nasic.js");

const op_kind = {
   0 : "+"  , "+"  : 0, 
   1 : "-"  , "-"  : 1, 
   2 : "*"  , "*"  : 2, 
   3 : "/"  , "/"  : 3, 
   4 : "%"  , "%"  : 4,
   5 : "**" , "**" : 5,
   6 : "&"  , "&"  : 6,
   7 : "|"  , "|"  : 7,
   8 : "^"  , "^"  : 8,
   9 : "~"  , "~"  : 9,
  10 : ">>" , ">>" : 10,
  11 : "<<" , "<<" : 11,
  12 : ">"  , ">"  : 12,
  13 : "<"  , "<"  : 13,
  14 : "==" , "=="  : 14,
};

const compile = (term, defs = {}) => {
  const build_net = (term, net, var_ptrs, level) => {
    const get_var = (ptrn) => {
      if (net.enter_port(ptrn) === ptrn) {
        return ptrn;
      } else {
        var dups_ptrn = net.enter_port(ptrn);
        var dup_addr = net.alloc_node(NOD, Math.floor((1 + Math.random()) * Math.pow(2,16)));
        net.link_ports(Pointer(dup_addr, 0), ptrn);
        net.link_ports(Pointer(dup_addr, 1), dups_ptrn);
        return Pointer(dup_addr, 2);
      }
    };
    switch (term[0]) {
      case "Dup":
        var expr_ptr = build_net(term[1].expr, net, var_ptrs, level);
        var_ptrs.push(expr_ptr);
        var body_ptr = build_net(term[1].body, net, var_ptrs, level);
        var_ptrs.pop();
        return body_ptr;
      case "Put":
        var expr_ptr = build_net(term[1].expr, net, var_ptrs, level + 1);
        return expr_ptr;
      case "Lam":
        var lam_addr = net.alloc_node(NOD, 1);
        net.link_ports(Pointer(lam_addr, 1), Pointer(lam_addr, 1));
        var_ptrs.push(Pointer(lam_addr, 1));
        var body_ptr = build_net(term[1].body, net, var_ptrs, level);
        var_ptrs.pop();
        net.link_ports(Pointer(lam_addr, 2), body_ptr);
        return Pointer(lam_addr, 0);
      case "App":
        var app_addr = net.alloc_node(NOD, 1);
        var func_ptr = build_net(term[1].func, net, var_ptrs, level);
        net.link_ports(Pointer(app_addr, 0), func_ptr);
        var argm_ptr = build_net(term[1].argm, net, var_ptrs, level);
        net.link_ports(Pointer(app_addr, 1), argm_ptr)
        return Pointer(app_addr, 2);
      case "Num":
        return Numeric(term[1].numb | 0);
      case "Op1":
        var op1_addr = net.alloc_node(OP1, op_kind[term[1].func]);
        net.link_ports(Numeric(term[1].num1[1].numb), Pointer(op1_addr, 1));
        var num0_ptr = build_net(term[1].num0, net, var_ptrs, level);
        net.link_ports(num0_ptr, Pointer(op1_addr, 0));
        return Pointer(op1_addr, 2);
      case "Op2":
        var op2_addr = net.alloc_node(OP2, op_kind[term[1].func]);
        var num0_ptr = build_net(term[1].num0, net, var_ptrs, level);
        net.link_ports(Pointer(op2_addr, 1), num0_ptr);
        var num1_ptr = build_net(term[1].num1, net, var_ptrs, level);
        net.link_ports(Pointer(op2_addr, 0), num1_ptr);
        return Pointer(op2_addr, 2);
      case "Var":
        return get_var(var_ptrs[var_ptrs.length - term[1].index - 1]);
      case "Ref":
        return build_net(defs[term[1].name], net, var_ptrs, level);
      default:
        return build_net(Lam("", null, Var(0)), net, var_ptrs, level);
    }
  };
  var level_of = {};
  var net = new Net();
  var root_addr = net.alloc_node(NOD, 0);
  var term_ptr = build_net(term, net, [], 0);
  net.link_ports(Pointer(root_addr, 0), Pointer(root_addr, 2));
  net.link_ports(Pointer(root_addr, 1), term_ptr);
  // Removes invalid redexes. They can be created by the
  // compiler when duplicating variables more than once.
  net.redex = net.redex.filter((a_addr) => {
    var b_ptrn = net.enter_port(Pointer(a_addr, 0));
    if (type_of(b_ptrn) !== NUM) {
      var b_addr = addr_of(b_ptrn);
      var a_p0 = Pointer(a_addr, 0);
      var b_p0 = Pointer(b_addr, 0);
      var a_ok = net.enter_port(a_p0) === b_p0;
      var b_ok = net.enter_port(b_p0) === a_p0;
      return a_ok && b_ok;
    } else {
      return true;
    }
  });
  return net;
};

const decompile = (net) => {
  const build_term = (net, ptrn, var_ptrs, dup_exit) => {
    if (type_of(ptrn) === NUM) {
      return Num(numb_of(ptrn));
    } else {
      var addr = addr_of(ptrn);
      var type = net.type_of(addr);
      var kind = net.kind_of(addr);
      if (type === NOD) {
        if (kind === 1) {
          switch (slot_of(ptrn)) {
            case 0:
              var_ptrs.push(Pointer(addr, 1));
              var body = build_term(net, net.enter_port(Pointer(addr, 2)), var_ptrs, dup_exit);
              var_ptrs.pop();
              return Lam(gen_name(var_ptrs.length), body);
            case 1:
              for (var index = 0; index < var_ptrs.length; ++index) {
                if (var_ptrs[var_ptrs.length - index - 1] === ptrn) {
                  return Var(index);
                }
              }
            case 2:
              var argm = build_term(net, net.enter_port(Pointer(addr, 1)), var_ptrs, dup_exit);
              var func = build_term(net, net.enter_port(Pointer(addr, 0)), var_ptrs, dup_exit);
              return App(func, argm);
          }
        } else {
          switch (slot_of(ptrn)) {
            case 0:
              var exit = dup_exit.pop();
              var term = build_term(net, net.enter_port(Pointer(addr, exit)), var_ptrs, dup_exit);
              dup_exit.push(exit);
              return term;
            default:
              dup_exit.push(slot_of(ptrn));
              var term = build_term(net, net.enter_port(Pointer(addr, 0)), var_ptrs, dup_exit);
              dup_exit.pop();
              return term;
          }
        }
      } else if (type === OP1) {
        var num0 = build_term(net, net.enter_port(Pointer(addr, 0)), var_ptrs, dup_exit);
        var num1 = Num(numb_of(net.enter_port(Pointer(addr, 1))));
        return Op1(op_kind[kind], num0, num1);
      } else if (type === OP2) {
        var num0 = build_term(net, net.enter_port(Pointer(addr, 1)), var_ptrs, dup_exit);
        var num1 = build_term(net, net.enter_port(Pointer(addr, 0)), var_ptrs, dup_exit);
        return Op2(op_kind[kind], num0, num1);
      }
    }
  };
  return build_term(net, net.enter_port(Pointer(0, 1)), [], []);
};

const norm_with_stats = (term, defs = {}, lazy = true) => {
  var net = compile(term, defs);
  var stats = lazy ? net.reduce_lazy() : net.reduce();
  var norm = decompile(net);
  return {norm, stats};
};

const norm = (term, defs, lazy) => {
  return norm_with_stats(term, defs, lazy).norm;
};

module.exports = {compile, decompile, norm_with_stats, norm};
