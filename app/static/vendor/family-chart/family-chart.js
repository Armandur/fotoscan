// https://donatso.github.io/family-chart/ v0.9.0 Copyright 2025 donatso
(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('d3')) :
    typeof define === 'function' && define.amd ? define(['exports', 'd3'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.f3 = {}, global.d3));
})(this, (function (exports, d3) { 'use strict';

    function _interopNamespaceDefault(e) {
        var n = Object.create(null);
        if (e) {
            Object.keys(e).forEach(function (k) {
                if (k !== 'default') {
                    var d = Object.getOwnPropertyDescriptor(e, k);
                    Object.defineProperty(n, k, d.get ? d : {
                        enumerable: true,
                        get: function () { return e[k]; }
                    });
                }
            });
        }
        n.default = e;
        return Object.freeze(n);
    }

    var d3__namespace = /*#__PURE__*/_interopNamespaceDefault(d3);

    function sortChildrenWithSpouses(children, datum, data) {
        if (!datum.rels.children)
            return;
        const spouses = datum.rels.spouses || [];
        return children.sort((a, b) => {
            const a_p2 = otherParent(a, datum, data);
            const b_p2 = otherParent(b, datum, data);
            const a_i = a_p2 ? spouses.indexOf(a_p2.id) : -1;
            const b_i = b_p2 ? spouses.indexOf(b_p2.id) : -1;
            if (datum.data.gender === "M")
                return a_i - b_i;
            else
                return b_i - a_i;
        });
    }
    function sortAddNewChildren(children) {
        return children.sort((a, b) => {
            const a_new = a._new_rel_data;
            const b_new = b._new_rel_data;
            if (a_new && !b_new)
                return 1;
            if (!a_new && b_new)
                return -1;
            return 0;
        });
    }
    function otherParent(d, p1, data) {
        return data.find(d0 => (d0.id !== p1.id) && (d.rels.parents.includes(d0.id)));
    }
    function calculateEnterAndExitPositions(d, entering, exiting) {
        d.exiting = exiting;
        if (entering) {
            if (d.depth === 0 && !d.spouse) {
                d._x = d.x;
                d._y = d.y;
            }
            else if (d.spouse) {
                d._x = d.spouse.x;
                d._y = d.spouse.y;
            }
            else if (d.is_ancestry) {
                if (!d.parent)
                    throw new Error('no parent');
                d._x = d.parent.x;
                d._y = d.parent.y;
            }
            else {
                d._x = d.psx;
                d._y = d.psy;
            }
        }
        else if (exiting) {
            const x = d.x > 0 ? 1 : -1, y = d.y > 0 ? 1 : -1;
            {
                d._x = d.x + 400 * x;
                d._y = d.y + 400 * y;
            }
        }
    }
    function setupSiblings({ tree, data_stash, node_separation, sortChildrenFunction }) {
        const main = tree.find(d => d.data.main);
        if (!main)
            throw new Error('no main');
        const p1 = main.data.rels.parents[0];
        const p2 = main.data.rels.parents[1];
        const siblings = findSiblings(main);
        if (siblings.length > 0 && !main.parents)
            throw new Error('no parents');
        const siblings_added = addSiblingsToTree(main);
        positionSiblings(main);
        function findSiblings(main) {
            return data_stash.filter(d => {
                if (d.id === main.data.id)
                    return false;
                if (p1 && d.rels.parents.includes(p1))
                    return true;
                if (p2 && d.rels.parents.includes(p2))
                    return true;
                return false;
            });
        }
        function addSiblingsToTree(main) {
            const siblings_added = [];
            for (let i = 0; i < siblings.length; i++) {
                const sib = {
                    data: siblings[i],
                    sibling: true,
                    x: 0.0, // to be calculated in positionSiblings
                    y: main.y,
                    depth: main.depth - 1,
                    parents: []
                };
                const p1 = main.parents.find(d => d.data.id === sib.data.rels.parents[0]);
                const p2 = main.parents.find(d => d.data.id === sib.data.rels.parents[1]);
                if (p1)
                    sib.parents.push(p1);
                if (p2)
                    sib.parents.push(p2);
                tree.push(sib);
                siblings_added.push(sib);
            }
            return siblings_added;
        }
        function positionSiblings(main) {
            var _a, _b;
            const sorted_siblings = [main, ...siblings_added];
            if (sortChildrenFunction)
                sorted_siblings.sort((a, b) => sortChildrenFunction(a.data, b.data)); // first sort by custom function if provided
            sorted_siblings.sort((a, b) => {
                const a_p1 = main.parents.find(d => d.data.id === a.data.rels.parents[0]);
                const a_p2 = main.parents.find(d => d.data.id === a.data.rels.parents[1]);
                const b_p1 = main.parents.find(d => d.data.id === b.data.rels.parents[0]);
                const b_p2 = main.parents.find(d => d.data.id === b.data.rels.parents[1]);
                if (!a_p2 && b_p2)
                    return -1;
                if (a_p2 && !b_p2)
                    return 1;
                if (!a_p1 && b_p1)
                    return 1;
                if (a_p1 && !b_p1)
                    return -1;
                // If both have same parents or both missing same parent, maintain original order
                return 0;
            });
            const main_x = main.x;
            const spouses_x = (main.spouses || []).map(d => d.x);
            const x_range = d3__namespace.extent([main_x, ...spouses_x]);
            const main_sorted_index = sorted_siblings.findIndex(d => d.data.id === main.data.id);
            for (let i = 0; i < sorted_siblings.length; i++) {
                if (i === main_sorted_index)
                    continue;
                const sib = sorted_siblings[i];
                if (i < main_sorted_index) {
                    sib.x = ((_a = x_range[0]) !== null && _a !== void 0 ? _a : 0) - node_separation * (main_sorted_index - i);
                }
                else {
                    sib.x = ((_b = x_range[1]) !== null && _b !== void 0 ? _b : 0) + node_separation * (i - main_sorted_index);
                }
            }
        }
    }
    function handlePrivateCards({ tree, data_stash, private_cards_config }) {
        const private_persons = {};
        const condition = private_cards_config.condition;
        if (!condition)
            return console.error('private_cards_config.condition is not set');
        tree.forEach(d => {
            if (d.data._new_rel_data)
                return;
            const is_private = isPrivate(d.data.id);
            if (is_private)
                d.is_private = is_private;
            return;
        });
        function isPrivate(d_id) {
            const parents_and_spouses_checked = [];
            let is_private = false;
            checkParentsAndSpouses(d_id);
            private_persons[d_id] = is_private;
            return is_private;
            function checkParentsAndSpouses(d_id) {
                if (is_private)
                    return;
                if (private_persons.hasOwnProperty(d_id)) {
                    is_private = private_persons[d_id];
                    return is_private;
                }
                const d = data_stash.find(d0 => d0.id === d_id);
                if (!d)
                    throw new Error('no d');
                if (d._new_rel_data)
                    return;
                if (condition(d)) {
                    is_private = true;
                    return true;
                }
                const rels = d.rels;
                [...rels.parents, ...(rels.spouses || [])].forEach(d0_id => {
                    if (!d0_id)
                        return;
                    if (parents_and_spouses_checked.includes(d0_id))
                        return;
                    parents_and_spouses_checked.push(d0_id);
                    checkParentsAndSpouses(d0_id);
                });
            }
        }
    }
    function getMaxDepth(d_id, data_stash) {
        const datum = data_stash.find(d => d.id === d_id);
        if (!datum)
            throw new Error('no datum');
        const root_ancestry = d3__namespace.hierarchy(datum, d => hierarchyGetterParents(d));
        const root_progeny = d3__namespace.hierarchy(datum, d => hierarchyGetterChildren(d));
        return {
            ancestry: root_ancestry.height,
            progeny: root_progeny.height
        };
        function hierarchyGetterChildren(d) {
            return [...(d.rels.children || [])]
                .map(id => data_stash.find(d => d.id === id))
                .filter(d => d && !d._new_rel_data && !d.to_add);
        }
        function hierarchyGetterParents(d) {
            return d.rels.parents
                .filter(d => d)
                .map(id => data_stash.find(d => d.id === id))
                .filter(d => d && !d._new_rel_data && !d.to_add);
        }
    }

    function createNewPerson({ data, rels }) {
        return {
            id: generateUUID(),
            data: data || {},
            rels: Object.assign({ parents: [], children: [], spouses: [] }, (rels || {}))
        };
    }
    function createNewPersonWithGenderFromRel({ data, rel_type, rel_datum }) {
        const gender = getGenderFromRelative(rel_datum, rel_type);
        data = Object.assign(data || {}, { gender });
        return createNewPerson({ data });
        function getGenderFromRelative(rel_datum, rel_type) {
            return (["daughter", "mother"].includes(rel_type) || rel_type === "spouse" && rel_datum.data.gender === "M") ? "F" : "M";
        }
    }
    function addNewPerson({ data_stash, datum }) {
        data_stash.push(datum);
    }
    function generateUUID() {
        var d = new Date().getTime();
        var d2 = (performance && performance.now && (performance.now() * 1000)) || 0; //Time in microseconds since page-load or 0 if unsupported
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16;
            if (d > 0) { //Use timestamp until depleted
                r = (d + r) % 16 | 0;
                d = Math.floor(d / 16);
            }
            else { //Use microseconds since page-load if supported
                r = (d2 + r) % 16 | 0;
                d2 = Math.floor(d2 / 16);
            }
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function isAllRelativeDisplayed(d, data) {
        const r = d.data.rels;
        const all_rels = [...r.parents, ...(r.spouses || []), ...(r.children || [])].filter(v => v);
        return all_rels.every(rel_id => data.some(d => d.data.id === rel_id));
    }
    function calculateDelay(tree, d, transition_time) {
        const delay_level = transition_time * .4;
        const ancestry_levels = Math.max(...tree.data.map(d => d.is_ancestry ? d.depth : 0));
        let delay = d.depth * delay_level;
        if ((d.depth !== 0 || !!d.spouse) && !d.is_ancestry) {
            delay += (ancestry_levels) * delay_level; // after ancestry
            if (d.spouse)
                delay += delay_level; // spouse after bloodline
            delay += (d.depth) * delay_level; // double the delay for each level because of additional spouse delay
        }
        return delay;
    }

    function handleDuplicateSpouseToggle(tree) {
      tree.forEach(d => {
        if (!d.spouse) return
        const spouse = d.spouse;
        if (d.duplicate && spouse.data._tgdp_sp) {
          const parent_id = spouse.data.main ? 'main' : spouse.parent.data.id;
          if (spouse.data._tgdp_sp[parent_id]?.hasOwnProperty(d.data.id)) {
            d._toggle = spouse.data._tgdp_sp[parent_id][d.data.id];
          }
        }
      });
    }

    function handleDuplicateHierarchyProgeny(root, data_stash, on_toggle_one_close_others=true) {
      const progeny_duplicates = [];
      loopChildren(root);
      setToggleIds(progeny_duplicates);

      function loopChildren(d) {
        if (!d.children) return
        const p1 = d.data;
        const spouses = (d.data.rels.spouses || []).map(id => data_stash.find(d => d.id === id));

        const children_by_spouse = getChildrenBySpouse(d);
        spouses.forEach(p2 => {
          if (progeny_duplicates.some(d => d.some(d => checkIfDuplicate([p1, p2], [d.p1, d.p2])))) {
            return
          }
          const duplicates = findDuplicates(d, p1, p2);
          if (duplicates.length > 0) {
            const all_duplicates = [{d, p1, p2}, ...duplicates];
            progeny_duplicates.push(all_duplicates);
            assignDuplicateValues(all_duplicates);
            handleToggleOff(all_duplicates);
          } else {
            let parent_id = root === d ? 'main' : d.parent.data.id;
            stashTgdpSpouse(d, parent_id, p2);
            (children_by_spouse[p2.id] || []).forEach(child => {
              loopChildren(child);
            });
          }
        });
      }

      function assignDuplicateValues(all_duplicates) {
        all_duplicates.forEach(({d, p1, p2}, i) => {
          if (!d.data._tgdp_sp) d.data._tgdp_sp = {};
          let parent_id = root === d ? 'main' : d.parent.data.id;
          unstashTgdpSpouse(d, parent_id, p2);
          if (!d.data._tgdp_sp[parent_id]) d.data._tgdp_sp[parent_id] = {};
          let val = 1;
          if (!d.data._tgdp_sp[parent_id].hasOwnProperty(p2.id)) d.data._tgdp_sp[parent_id][p2.id] = val;
          else val = d.data._tgdp_sp[parent_id][p2.id];
          all_duplicates[i].val = val;
        });

        if (on_toggle_one_close_others) {
          if (all_duplicates.every(d => d.val < 0)) {
            const first_duplicate = all_duplicates.sort((a, b) => b.val - a.val)[0];
            const {d, p1, p2} = first_duplicate;
            const parent_id = root === d ? 'main' : d.parent.data.id;
            d.data._tgdp_sp[parent_id][p2.id] = 1;
          }
      
          if (all_duplicates.filter(d => d.val > 0).length > 1) {
            const latest_duplicate = all_duplicates.sort((a, b) => b.val - a.val)[0];
            all_duplicates.forEach(dupl => {
              if (dupl === latest_duplicate) return
              const {d, p1, p2} = dupl;
              const parent_id = root === d ? 'main' : d.parent.data.id;
              d.data._tgdp_sp[parent_id][p2.id] = -1;
            });
          }
        }
      }

      function handleToggleOff(all_duplicates) {
        all_duplicates.forEach(({d, p1, p2}) => {
          const parent_id = root === d ? 'main' : d.parent.data.id;
          if (d.data._tgdp_sp[parent_id][p2.id] < 0) {
            const children_by_spouse = getChildrenBySpouse(d);
            if (children_by_spouse[p2.id]) {
              d.children = d.children.filter(c => !children_by_spouse[p2.id].includes(c));
              if (d.children.length === 0) delete d.children;
            }
          }
        });
      }

      function stashTgdpSpouse(d, parent_id, p2) {
        if (d.data._tgdp_sp && d.data._tgdp_sp[parent_id] && d.data._tgdp_sp[parent_id].hasOwnProperty(p2.id)) {
          if (!d.data.__tgdp_sp) d.data.__tgdp_sp = {};
          if (!d.data.__tgdp_sp[parent_id]) d.data.__tgdp_sp[parent_id] = {};
          d.data.__tgdp_sp[parent_id][p2.id] = d.data._tgdp_sp[parent_id][p2.id];
          delete d.data._tgdp_sp[parent_id][p2.id];
        }
      }

      function unstashTgdpSpouse(d, parent_id, p2) {
        if (d.data.__tgdp_sp && d.data.__tgdp_sp[parent_id] && d.data.__tgdp_sp[parent_id].hasOwnProperty(p2.id)) {
          d.data._tgdp_sp[parent_id][p2.id] = d.data.__tgdp_sp[parent_id][p2.id];
          delete d.data.__tgdp_sp[parent_id][p2.id];
        }
      }

      function findDuplicates(datum, partner1, partner2) {
        const duplicates = [];
        checkChildren(root);
        return duplicates

        function checkChildren(d) {
          if (d === datum) return
          if (d.children) {
            const p1 = d.data;
            const spouses = (d.data.rels.spouses || []).map(id => data_stash.find(d => d.id === id));
            const children_by_spouse = getChildrenBySpouse(d);
            spouses.forEach(p2 => {
              if (checkIfDuplicate([partner1, partner2], [p1, p2])) {
                duplicates.push({d, p1, p2});
              } else {
                (children_by_spouse[p2.id] || []).forEach(child => {
                  checkChildren(child);
                });
              }
            });
          }
        }
      }

      function checkIfDuplicate(arr1, arr2) {
        return arr1.every(d => arr2.some(d0 => d.id === d0.id))
      }

      function getChildrenBySpouse(d) {
        const children_by_spouse = {};
        const p1 = d;
        (d.children || []).forEach(child => {
          const ch_rels = child.data.rels;
          const p2_id = ch_rels.parents[0] === p1.data.id ? ch_rels.parents[1] : ch_rels.parents[0];
          if (!children_by_spouse[p2_id]) children_by_spouse[p2_id] = [];
          children_by_spouse[p2_id].push(child);
        });
        return children_by_spouse
      }

      function setToggleIds(progeny_duplicates) {
        let toggle_id = 0;
        progeny_duplicates.forEach(dupl_arr => {
          toggle_id = toggle_id+1;
          dupl_arr.forEach(d => {
            if (!d.d._toggle_id_sp) d.d._toggle_id_sp = {};
            d.d._toggle_id_sp[d.p2.id] = toggle_id;
          });
        });
      }
    }

    function handleDuplicateHierarchyAncestry(root, on_toggle_one_close_others=true) {
      const ancestry_duplicates = [];

      loopChildren(root);

      setToggleIds(ancestry_duplicates);


      function loopChildren(d) {
        if (d.children) {
          if (ancestry_duplicates.some(d0 => d0.includes(d))) {
            return
          }
          const duplicates = findDuplicates(d.children);
          if (duplicates.length > 0) {
            const all_duplicates = [d, ...duplicates];
            ancestry_duplicates.push(all_duplicates);
            assignDuplicateValues(all_duplicates);
            handleToggleOff(all_duplicates);
          } else {
            d.children.forEach(child => {
              loopChildren(child);
            });
          }
        }
      }

      function assignDuplicateValues(all_duplicates) {
        all_duplicates.forEach(d => {
          if (!d.data._tgdp) d.data._tgdp = {};
          const parent_id = root === d ? 'main' : d.parent.data.id;
          if (!d.data._tgdp[parent_id]) d.data._tgdp[parent_id] = -1;
          d._toggle = d.data._tgdp[parent_id];
        });

        if (on_toggle_one_close_others) {
          if (all_duplicates.every(d => d._toggle < 0)) {
            const first_duplicate = all_duplicates.sort((a, b) => b._toggle - a._toggle)[0];
            const d= first_duplicate;
            const parent_id = root === d ? 'main' : d.parent.data.id;
            d.data._tgdp[parent_id] = 1;
          }
      
          if (all_duplicates.filter(d => d._toggle > 0).length > 1) {
            const latest_duplicate = all_duplicates.sort((a, b) => b._toggle - a._toggle)[0];
            all_duplicates.forEach(dupl => {
              if (dupl === latest_duplicate) return
              const d = dupl;
              const parent_id = root === d ? 'main' : d.parent.data.id;
              d.data._tgdp[parent_id] = -1;
            });
          }
        }
      }

      function handleToggleOff(all_duplicates) {
        all_duplicates.forEach(d => {
          const parent_id = root === d ? 'main' : d.parent.data.id;
          if (d.data._tgdp[parent_id] < 0) delete d.children;
        });
      }

      function findDuplicates(children_1) {
        const duplicates = [];
        checkChildren(root);
        return duplicates

        function checkChildren(d) {
          if (d.children) {
            if (checkIfDuplicate(children_1, d.children)) {
              duplicates.push(d);
            } else {
              d.children.forEach(child => {
                checkChildren(child);
              });
            }
          }
        }
      }

      function checkIfDuplicate(arr1, arr2) {
        return arr1 !== arr2 && arr1.every(d => arr2.some(d0 => d.data.id === d0.data.id))
      }

      function setToggleIds(ancestry_duplicates) {
        let toggle_id = 0;
        ancestry_duplicates.forEach(dupl_arr => {
          toggle_id = toggle_id+1;
          dupl_arr.forEach(d => {
            d._toggle_id = toggle_id;
          });
        });
      }
    }

    function formatData(data) {
        data.forEach((d) => {
            if (!d.rels.parents)
                d.rels.parents = [];
            if (!d.rels.spouses)
                d.rels.spouses = [];
            if (!d.rels.children)
                d.rels.children = [];
            convertFatherMotherToParents(d);
        });
        return data;
        function convertFatherMotherToParents(d) {
            if (!d.rels.parents)
                d.rels.parents = [];
            if (d.rels.father)
                d.rels.parents.push(d.rels.father);
            if (d.rels.mother)
                d.rels.parents.push(d.rels.mother);
            delete d.rels.father;
            delete d.rels.mother;
        }
    }
    function formatDataForExport(data, legacy_format = false) {
        data.forEach(d => {
            var _a;
            if (legacy_format) {
                let father;
                let mother;
                (_a = d.rels.parents) === null || _a === void 0 ? void 0 : _a.forEach(p => {
                    const parent = data.find(d => d.id === p);
                    if (!parent)
                        throw new Error('Parent not found');
                    if (parent.data.gender === "M") {
                        if (!father)
                            father = parent.id;
                        else
                            mother = parent.id; // for same sex parents, we set some parent to father and some to mother
                    }
                    if (parent.data.gender === "F") {
                        if (!mother)
                            mother = parent.id;
                        else
                            father = parent.id; // for same sex parents, we set some parent to father and some to mother
                    }
                });
                if (father)
                    d.rels.father = father;
                if (mother)
                    d.rels.mother = mother;
                delete d.rels.parents;
            }
            if (d.rels.parents && d.rels.parents.length === 0)
                delete d.rels.parents;
            if (d.rels.spouses && d.rels.spouses.length === 0)
                delete d.rels.spouses;
            if (d.rels.children && d.rels.children.length === 0)
                delete d.rels.children;
        });
        return data;
    }

    function calculateTree(data, { main_id = null, node_separation = 250, level_separation = 150, single_parent_empty_card = true, is_horizontal = false, one_level_rels = false, sortChildrenFunction = undefined, sortSpousesFunction = undefined, ancestry_depth = undefined, progeny_depth = undefined, show_siblings_of_main = false, modifyTreeHierarchy = undefined, private_cards_config = undefined, duplicate_branch_toggle = false, on_toggle_one_close_others = true, }) {
        if (!data || !data.length)
            throw new Error('No data');
        if (is_horizontal)
            [node_separation, level_separation] = [level_separation, node_separation];
        const data_stash = single_parent_empty_card ? createRelsToAdd(data) : data;
        if (!main_id || !data_stash.find(d => d.id === main_id))
            main_id = data_stash[0].id;
        const main = data_stash.find(d => d.id === main_id);
        if (!main)
            throw new Error('Main not found');
        const tree_children = calculateTreePositions(main, 'children', false);
        const tree_parents = calculateTreePositions(main, 'parents', true);
        data_stash.forEach(d => d.main = d === main);
        levelOutEachSide(tree_parents, tree_children);
        const tree = mergeSides(tree_parents, tree_children);
        setupChildrenAndParents(tree);
        setupSpouses(tree, node_separation);
        if (show_siblings_of_main && !one_level_rels)
            setupSiblings({ tree, data_stash, node_separation, sortChildrenFunction });
        setupProgenyParentsPos(tree);
        nodePositioning(tree);
        tree.forEach(d => d.all_rels_displayed = isAllRelativeDisplayed(d, tree));
        if (private_cards_config)
            handlePrivateCards({ tree, data_stash, private_cards_config });
        setupTid(tree);
        // setupFromTo(tree)
        if (duplicate_branch_toggle)
            handleDuplicateSpouseToggle(tree);
        const dim = calculateTreeDim(tree, node_separation, level_separation);
        return { data: tree, data_stash, dim, main_id: main.id, is_horizontal };
        function calculateTreePositions(datum, rt, is_ancestry) {
            const hierarchyGetter = rt === "children" ? hierarchyGetterChildren : hierarchyGetterParents;
            const d3_tree = d3__namespace.tree().nodeSize([node_separation, level_separation]).separation(separation);
            const root = d3__namespace.hierarchy(datum, hierarchyGetter);
            trimTree(root, is_ancestry);
            if (duplicate_branch_toggle)
                handleDuplicateHierarchy(root, data_stash, is_ancestry);
            if (modifyTreeHierarchy)
                modifyTreeHierarchy(root, is_ancestry);
            d3_tree(root);
            const tree = root.descendants();
            tree.forEach(d => {
                if (d.x === undefined)
                    d.x = 0;
                if (d.y === undefined)
                    d.y = 0;
            });
            return tree;
            function separation(a, b) {
                let offset = 1;
                if (!is_ancestry) {
                    if (!sameParent(a, b))
                        offset += .25;
                    if (!one_level_rels) {
                        if (someSpouses(a, b))
                            offset += offsetOnPartners(a, b);
                    }
                    if (sameParent(a, b) && !sameBothParents(a, b))
                        offset += .125;
                }
                return offset;
            }
            function sameParent(a, b) { return a.parent == b.parent; }
            function sameBothParents(a, b) {
                const parentsA = [...a.data.rels.parents].sort();
                const parentsB = [...b.data.rels.parents].sort();
                return parentsA.length === parentsB.length && parentsA.every((p, i) => p === parentsB[i]);
            }
            function hasSpouses(d) { return d.data.rels.spouses && d.data.rels.spouses.length > 0; }
            function someSpouses(a, b) { return hasSpouses(a) || hasSpouses(b); }
            function hierarchyGetterChildren(d) {
                const children = [...(d.rels.children || [])].map(id => data_stash.find(d => d.id === id)).filter(d => d !== undefined);
                if (sortChildrenFunction)
                    children.sort(sortChildrenFunction); // first sort by custom function if provided
                sortAddNewChildren(children); // then put new children at the end
                if (sortSpousesFunction)
                    sortSpousesFunction(d, data_stash);
                sortChildrenWithSpouses(children, d, data_stash); // then sort by order of spouses
                return children;
            }
            function hierarchyGetterParents(d) {
                let parents = [...d.rels.parents];
                const p1 = data_stash.find(d => d.id === parents[0]);
                if (p1 && p1.data.gender === "F")
                    parents.reverse();
                return parents
                    .filter(d => d).map(id => data_stash.find(d => d.id === id)).filter(d => d !== undefined);
            }
            function offsetOnPartners(a, b) {
                return ((a.data.rels.spouses || []).length + (b.data.rels.spouses || []).length) * .5;
            }
        }
        function levelOutEachSide(parents, children) {
            const mid_diff = (parents[0].x - children[0].x) / 2;
            parents.forEach(d => d.x -= mid_diff);
            children.forEach(d => d.x += mid_diff);
        }
        function mergeSides(parents, children) {
            parents.forEach(d => { d.is_ancestry = true; });
            parents.forEach(d => d.depth === 1 ? d.parent = children[0] : null);
            return [...children, ...parents.slice(1)];
        }
        function nodePositioning(tree) {
            tree.forEach(d => {
                d.y *= (d.is_ancestry ? -1 : 1);
                if (is_horizontal) {
                    const d_x = d.x;
                    d.x = d.y;
                    d.y = d_x;
                }
            });
        }
        function setupSpouses(tree, node_separation) {
            for (let i = tree.length; i--;) {
                const d = tree[i];
                if (!d.is_ancestry) {
                    let spouses = d.data.rels.spouses || [];
                    if (d._ignore_spouses)
                        spouses = spouses.filter(sp_id => !d._ignore_spouses.includes(sp_id));
                    if (spouses.length > 0) {
                        if (one_level_rels && d.depth > 0)
                            continue;
                        const side = d.data.data.gender === "M" ? -1 : 1; // female on right
                        d.x += spouses.length / 2 * node_separation * side;
                        spouses.forEach((sp_id, i) => {
                            const spouse = {
                                data: data_stash.find(d0 => d0.id === sp_id),
                                added: true,
                                depth: d.depth,
                                spouse: d,
                                x: d.x - (node_separation * (i + 1)) * side,
                                y: d.y,
                                tid: `${d.data.id}-spouse-${i}`,
                            };
                            spouse.sx = i > 0 ? spouse.x : spouse.x + (node_separation / 2) * side;
                            spouse.sy = i > 0 ? spouse.y : spouse.y + (node_separation / 2) * side;
                            if (!d.spouses)
                                d.spouses = [];
                            d.spouses.push(spouse);
                            tree.push(spouse);
                        });
                    }
                }
                if (d.parents && d.parents.length === 2) {
                    const p1 = d.parents[0];
                    const p2 = d.parents[1];
                    const midd = p1.x - (p1.x - p2.x) / 2;
                    const x = (d, sp) => midd + (node_separation / 2) * (d.x < sp.x ? 1 : -1);
                    p2.x = x(p1, p2);
                    p1.x = x(p2, p1);
                }
            }
        }
        function setupProgenyParentsPos(tree) {
            tree.forEach(d => {
                if (d.is_ancestry)
                    return;
                if (d.depth === 0)
                    return;
                if (d.added)
                    return;
                if (d.sibling)
                    return;
                const p1 = d.parent;
                const p2 = ((p1 === null || p1 === void 0 ? void 0 : p1.spouses) || []).find((d0) => d.data.rels.parents.includes(d0.data.id));
                if (p1 && p2) {
                    if (!p1.added && !p2.added)
                        console.error('no added spouse', p1, p2);
                    const added_spouse = p1.added ? p1 : p2;
                    setupParentPos(d, added_spouse);
                }
                else if (p1 || p2) {
                    const parent = p1 || p2;
                    if (!parent)
                        throw new Error('no progeny parent');
                    parent.sx = parent.x;
                    parent.sy = parent.y;
                    setupParentPos(d, parent);
                }
                function setupParentPos(d, p) {
                    d.psx = !is_horizontal ? p.sx : p.y;
                    d.psy = !is_horizontal ? p.y : p.sx;
                }
            });
        }
        function setupChildrenAndParents(tree) {
            tree.forEach(d0 => {
                delete d0.children;
                tree.forEach(d1 => {
                    if (d1.parent === d0) {
                        if (d1.is_ancestry) {
                            if (!d0.parents)
                                d0.parents = [];
                            d0.parents.push(d1);
                        }
                        else {
                            if (!d0.children)
                                d0.children = [];
                            d0.children.push(d1);
                        }
                    }
                });
                if (d0.parents && d0.parents.length === 2) {
                    const p1 = d0.parents[0];
                    const p2 = d0.parents[1];
                    p1.coparent = p2;
                    p2.coparent = p1;
                }
            });
        }
        function calculateTreeDim(tree, node_separation, level_separation) {
            if (is_horizontal)
                [node_separation, level_separation] = [level_separation, node_separation];
            const w_extent = d3__namespace.extent(tree, (d) => d.x);
            const h_extent = d3__namespace.extent(tree, (d) => d.y);
            if (w_extent[0] === undefined || w_extent[1] === undefined || h_extent[0] === undefined || h_extent[1] === undefined)
                throw new Error('No extent');
            return {
                width: w_extent[1] - w_extent[0] + node_separation, height: h_extent[1] - h_extent[0] + level_separation, x_off: -w_extent[0] + node_separation / 2, y_off: -h_extent[0] + level_separation / 2
            };
        }
        function createRelsToAdd(data) {
            const to_add_spouses = [];
            for (let i = 0; i < data.length; i++) {
                const d = data[i];
                if (d.rels.children && d.rels.children.length > 0) {
                    if (!d.rels.spouses)
                        d.rels.spouses = [];
                    let to_add_spouse;
                    d.rels.children.forEach(d0 => {
                        const child = data.find(d1 => d1.id === d0);
                        if (child.rels.parents.length === 2)
                            return;
                        if (!to_add_spouse) {
                            to_add_spouse = findOrCreateToAddSpouse(d);
                        }
                        if (!to_add_spouse.rels.children)
                            to_add_spouse.rels.children = [];
                        to_add_spouse.rels.children.push(child.id);
                        if (child.rels.parents.length !== 1)
                            throw new Error('child has more than 1 parent');
                        child.rels.parents.push(to_add_spouse.id);
                    });
                }
            }
            to_add_spouses.forEach(d => data.push(d));
            return data;
            function findOrCreateToAddSpouse(d) {
                const spouses = (d.rels.spouses || []).map(sp_id => data.find(d0 => d0.id === sp_id)).filter(d => d !== undefined);
                return spouses.find(sp => sp.to_add) || createToAddSpouse(d);
            }
            function createToAddSpouse(d) {
                const spouse = createNewPerson({
                    data: { gender: d.data.gender === "M" ? "F" : "M" },
                    rels: { spouses: [d.id] }
                });
                spouse.to_add = true;
                to_add_spouses.push(spouse);
                if (!d.rels.spouses)
                    d.rels.spouses = [];
                d.rels.spouses.push(spouse.id);
                return spouse;
            }
        }
        function trimTree(root, is_ancestry) {
            let max_depth = is_ancestry ? ancestry_depth : progeny_depth;
            if (one_level_rels)
                max_depth = 1;
            if (!max_depth && max_depth !== 0)
                return root;
            trimNode(root, 0);
            return root;
            function trimNode(node, depth) {
                if (depth === max_depth) {
                    if (node.children)
                        delete node.children;
                }
                else if (node.children) {
                    node.children.forEach(child => {
                        trimNode(child, depth + 1);
                    });
                }
            }
        }
        function handleDuplicateHierarchy(root, data_stash, is_ancestry) {
            if (is_ancestry)
                handleDuplicateHierarchyAncestry(root, on_toggle_one_close_others);
            else
                handleDuplicateHierarchyProgeny(root, data_stash, on_toggle_one_close_others);
        }
    }
    function setupTid(tree) {
        const ids = [];
        tree.forEach(d => {
            if (ids.includes(d.data.id)) {
                const duplicates = tree.filter(d0 => d0.data.id === d.data.id);
                duplicates.forEach((d0, i) => {
                    d0.tid = `${d.data.id}--x${i + 1}`;
                    d0.duplicate = duplicates.length;
                    ids.push(d.data.id);
                });
            }
            else {
                d.tid = d.data.id;
                ids.push(d.data.id);
            }
        });
    }
    /**
     * Calculate the tree
     * @param options - The options for the tree
     * @param options.data - The data for the tree
     * @returns The tree
     * @deprecated Use f3.calculateTree instead
     */
    function CalculateTree(options) {
        return calculateTreeWithV1Data(options.data, options);
    }
    /**
     * Calculate the tree with v1 data
     * @param data - The data for the tree
     * @param options - The options for the tree
     * @returns The tree
     */
    function calculateTreeWithV1Data(data, options) {
        const formatted_data = formatData(data);
        return calculateTree(formatted_data, options);
    }

    function createStore(initial_state) {
        let onUpdate;
        const state = Object.assign({ transition_time: 1000 }, initial_state);
        state.main_id_history = [];
        if (state.data) {
            checkIfFmFormat(state.data);
            formatData(state.data);
        }
        const store = {
            state,
            updateTree: (props) => {
                if (!state.data || state.data.length === 0)
                    return;
                state.tree = calcTree();
                if (!state.main_id && state.tree)
                    updateMainId(state.tree.main_id);
                if (onUpdate)
                    onUpdate(props);
            },
            updateData: (data) => {
                checkIfFmFormat(data);
                formatData(data);
                state.data = data;
                validateMainId();
            },
            updateMainId,
            getMainId: () => state.main_id,
            getData: () => state.data,
            getTree: () => state.tree,
            setOnUpdate: (f) => onUpdate = f,
            getMainDatum,
            getDatum,
            getTreeMainDatum,
            getTreeDatum,
            getLastAvailableMainDatum,
            methods: {},
        };
        return store;
        function calcTree() {
            const args = {
                main_id: state.main_id,
            };
            if (state.node_separation !== undefined)
                args.node_separation = state.node_separation;
            if (state.level_separation !== undefined)
                args.level_separation = state.level_separation;
            if (state.single_parent_empty_card !== undefined)
                args.single_parent_empty_card = state.single_parent_empty_card;
            if (state.is_horizontal !== undefined)
                args.is_horizontal = state.is_horizontal;
            if (state.one_level_rels !== undefined)
                args.one_level_rels = state.one_level_rels;
            if (state.modifyTreeHierarchy !== undefined)
                args.modifyTreeHierarchy = state.modifyTreeHierarchy;
            if (state.sortChildrenFunction !== undefined)
                args.sortChildrenFunction = state.sortChildrenFunction;
            if (state.sortSpousesFunction !== undefined)
                args.sortSpousesFunction = state.sortSpousesFunction;
            if (state.ancestry_depth !== undefined)
                args.ancestry_depth = state.ancestry_depth;
            if (state.progeny_depth !== undefined)
                args.progeny_depth = state.progeny_depth;
            if (state.show_siblings_of_main !== undefined)
                args.show_siblings_of_main = state.show_siblings_of_main;
            if (state.private_cards_config !== undefined)
                args.private_cards_config = state.private_cards_config;
            if (state.duplicate_branch_toggle !== undefined)
                args.duplicate_branch_toggle = state.duplicate_branch_toggle;
            return calculateTree(state.data, args);
        }
        function getMainDatum() {
            const datum = state.data.find(d => d.id === state.main_id);
            if (!datum)
                throw new Error("Main datum not found");
            return datum;
        }
        function getDatum(id) {
            const datum = state.data.find(d => d.id === id);
            if (!datum)
                return undefined;
            return datum;
        }
        function getTreeMainDatum() {
            if (!state.tree)
                throw new Error("No tree");
            const found = state.tree.data.find(d => d.data.id === state.main_id);
            if (!found)
                throw new Error("No tree main datum");
            return found;
        }
        function getTreeDatum(id) {
            if (!state.tree)
                throw new Error("No tree");
            const found = state.tree.data.find(d => d.data.id === id);
            if (!found)
                return undefined;
            return found;
        }
        function updateMainId(id) {
            if (id === state.main_id)
                return;
            state.main_id_history = state.main_id_history.filter(d => d !== id).slice(-10);
            state.main_id_history.push(id);
            state.main_id = id;
        }
        function validateMainId() {
            if (state.main_id) {
                const mainExists = state.data.find(d => d.id === state.main_id);
                if (!mainExists && state.data.length > 0) {
                    // Set first datum as main if current main doesn't exist
                    updateMainId(state.data[0].id);
                }
            }
            else {
                if (state.data.length > 0) {
                    updateMainId(state.data[0].id);
                }
            }
        }
        // if main_id is deleted, get the last available main_id
        function getLastAvailableMainDatum() {
            let main_id = state.main_id_history.slice(0).reverse().find(id => getDatum(id));
            if (!main_id && state.data.length > 0)
                main_id = state.data[0].id;
            if (!main_id)
                throw new Error("No main id");
            if (main_id !== state.main_id)
                updateMainId(main_id);
            const main_datum = getDatum(main_id);
            if (!main_datum)
                throw new Error("Main datum not found");
            return main_datum;
        }
        function checkIfFmFormat(data) {
            if (state.legacy_format !== undefined)
                return; // already checked
            for (let d of data) {
                if (d.rels.father || d.rels.mother) {
                    state.legacy_format = true;
                    return;
                }
            }
            state.legacy_format = false;
        }
    }

    function positionTree({ t, svg, transition_time = 2000 }) {
        const el_listener = getZoomListener(svg);
        const zoom = el_listener.__zoomObj;
        d3__namespace.select(el_listener).transition().duration(transition_time || 0).delay(transition_time ? 100 : 0) // delay 100 because of weird error of undefined something in d3 zoom
            .call(zoom.transform, d3__namespace.zoomIdentity.scale(t.k).translate(t.x, t.y));
    }
    function treeFit({ svg, svg_dim, tree_dim, transition_time }) {
        const t = calculateTreeFit(svg_dim, tree_dim);
        positionTree({ t, svg, transition_time });
    }
    function calculateTreeFit(svg_dim, tree_dim) {
        let k = Math.min(svg_dim.width / tree_dim.width, svg_dim.height / tree_dim.height);
        if (k > 1)
            k = 1;
        const x = tree_dim.x_off + (svg_dim.width - tree_dim.width * k) / k / 2;
        const y = tree_dim.y_off + (svg_dim.height - tree_dim.height * k) / k / 2;
        return { k, x, y };
    }
    function cardToMiddle({ datum, svg, svg_dim, scale, transition_time }) {
        const k = scale || 1, x = svg_dim.width / 2 - datum.x * k, y = svg_dim.height / 2 - datum.y, t = { k, x: x / k, y: y / k };
        positionTree({ t, svg, transition_time });
    }
    function manualZoom({ amount, svg, transition_time = 500 }) {
        const el_listener = getZoomListener(svg);
        const zoom = el_listener.__zoomObj;
        if (!zoom)
            throw new Error('Zoom object not found');
        d3__namespace.select(el_listener).transition().duration(transition_time || 0).delay(transition_time ? 100 : 0) // delay 100 because of weird error of undefined something in d3 zoom
            .call(zoom.scaleBy, amount);
    }
    function getCurrentZoom(svg) {
        const el_listener = getZoomListener(svg);
        const currentTransform = d3__namespace.zoomTransform(el_listener);
        return currentTransform;
    }
    function zoomTo(svg, zoom_level) {
        const el_listener = getZoomListener(svg);
        const currentTransform = d3__namespace.zoomTransform(el_listener);
        manualZoom({ amount: zoom_level / currentTransform.k, svg });
    }
    function getZoomListener(svg) {
        const el_listener = svg.__zoomObj ? svg : svg.parentNode;
        if (!el_listener.__zoomObj)
            throw new Error('Zoom object not found');
        return el_listener;
    }
    function setupZoom(el, props = {}) {
        if (el.__zoom) {
            console.log('zoom already setup');
            return;
        }
        const view = el.querySelector('.view');
        const zoom = d3__namespace.zoom().on("zoom", (props.onZoom || zoomed));
        d3__namespace.select(el).call(zoom);
        el.__zoomObj = zoom;
        if (props.zoom_polite)
            zoom.filter(zoomFilter);
        function zoomed(e) {
            d3__namespace.select(view).attr("transform", e.transform);
        }
        function zoomFilter(e) {
            if (e.type === "wheel" && !e.ctrlKey)
                return false;
            else if (e.touches && e.touches.length < 2)
                return false;
            else
                return true;
        }
    }

    function createLinks(d, is_horizontal = false) {
        const links = [];
        // d.spouses is always added to non-ancestry side for main blodline nodes
        // d.coparent is added to ancestry side
        if (d.spouses || d.coparent)
            handleSpouse(d);
        handleAncestrySide(d);
        handleProgenySide(d);
        return links;
        function handleAncestrySide(d) {
            if (!d.parents)
                return;
            const p1 = d.parents[0];
            const p2 = d.parents[1] || p1;
            const p = { x: getMid(p1, p2, 'x'), y: getMid(p1, p2, 'y') };
            links.push({
                d: Link(d, p),
                _d: () => {
                    const _d = { x: d.x, y: d.y }, _p = { x: d.x, y: d.y };
                    return Link(_d, _p);
                },
                curve: true,
                id: linkId(d, p1, p2),
                depth: d.depth + 1,
                is_ancestry: true,
                source: d,
                target: [p1, p2]
            });
        }
        function handleProgenySide(d) {
            if (!d.children || d.children.length === 0)
                return;
            d.children.forEach((child, i) => {
                const other_parent = otherParent(child, d) || d;
                const sx = other_parent.sx;
                if (typeof sx !== 'number')
                    throw new Error('sx is not a number');
                const parent_pos = !is_horizontal ? { x: sx, y: d.y } : { x: d.x, y: sx };
                links.push({
                    d: Link(child, parent_pos),
                    _d: () => Link(parent_pos, { x: _or(parent_pos, 'x'), y: _or(parent_pos, 'y') }),
                    curve: true,
                    id: linkId(child, d, other_parent),
                    depth: d.depth + 1,
                    is_ancestry: false,
                    source: [d, other_parent],
                    target: child
                });
            });
        }
        function handleSpouse(d) {
            if (d.spouses) {
                d.spouses.forEach(spouse => links.push(createSpouseLink(d, spouse)));
            }
            else if (d.coparent) {
                links.push(createSpouseLink(d, d.coparent));
            }
            function createSpouseLink(d, spouse) {
                return {
                    d: [[d.x, d.y], [spouse.x, spouse.y]],
                    _d: () => [
                        d.is_ancestry ? [_or(d, 'x') - .0001, _or(d, 'y')] : [d.x, d.y], // add -.0001 to line to have some length if d.x === spouse.x
                        d.is_ancestry ? [_or(spouse, 'x'), _or(spouse, 'y')] : [d.x - .0001, d.y]
                    ],
                    curve: false,
                    id: linkId(d, spouse),
                    depth: d.depth,
                    spouse: true,
                    is_ancestry: spouse.is_ancestry,
                    source: d,
                    target: spouse
                };
            }
        }
        ///
        function getMid(d1, d2, side, is_ = false) {
            if (is_)
                return _or(d1, side) - (_or(d1, side) - _or(d2, side)) / 2;
            else
                return d1[side] - (d1[side] - d2[side]) / 2;
        }
        function _or(d, side) {
            const n = d.hasOwnProperty(`_${side}`) ? d[`_${side}`] : d[side];
            if (typeof n !== 'number')
                throw new Error(`${side} is not a number`);
            return n;
        }
        function Link(d, p) {
            return is_horizontal ? LinkHorizontal(d, p) : LinkVertical(d, p);
        }
        function LinkVertical(d, p) {
            const hy = (d.y + (p.y - d.y) / 2);
            return [
                [d.x, d.y],
                [d.x, hy],
                [d.x, hy],
                [p.x, hy],
                [p.x, hy],
                [p.x, p.y],
            ];
        }
        function LinkHorizontal(d, p) {
            const hx = (d.x + (p.x - d.x) / 2);
            return [
                [d.x, d.y],
                [hx, d.y],
                [hx, d.y],
                [hx, p.y],
                [hx, p.y],
                [p.x, p.y],
            ];
        }
        function linkId(...args) {
            return args.map(d => d.tid).sort().join(", "); // make unique id
        }
        function otherParent(child, p1) {
            const p2 = (p1.spouses || []).find(d => child.data.rels.parents.includes(d.data.id));
            return p2;
        }
    }

    function updateLinks(svg, tree, props = {}) {
        const links_data_dct = tree.data.reduce((acc, d) => {
            createLinks(d, tree.is_horizontal).forEach(l => acc[l.id] = l);
            return acc;
        }, {});
        const links_data = Object.values(links_data_dct);
        const link = d3__namespace
            .select(svg)
            .select(".links_view")
            .selectAll("path.link")
            .data(links_data, d => d.id);
        if (props.transition_time === undefined)
            throw new Error('transition_time is undefined');
        const link_exit = link.exit();
        const link_enter = link.enter().append("path").attr("class", "link");
        const link_update = link_enter.merge(link);
        link_exit.each(linkExit);
        link_enter.each(linkEnter);
        link_update.each(linkUpdate);
        function linkEnter(d) {
            d3__namespace.select(this).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1).style("opacity", 0)
                .attr("d", createPath(d, true));
        }
        function linkUpdate(d) {
            const path = d3__namespace.select(this);
            const delay = props.initial ? calculateDelay(tree, d, props.transition_time) : 0;
            path.transition('path').duration(props.transition_time).delay(delay).attr("d", createPath(d)).style("opacity", 1);
        }
        function linkExit(d) {
            const path = d3__namespace.select(this);
            path.transition('op').duration(800).style("opacity", 0);
            path.transition('path').duration(props.transition_time).attr("d", createPath(d, true))
                .on("end", () => path.remove());
        }
    }
    function createPath(d, is_ = false) {
        const line = d3__namespace.line().curve(d3__namespace.curveMonotoneY);
        const lineCurve = d3__namespace.line().curve(d3__namespace.curveBasis);
        const path_data = is_ ? d._d() : d.d;
        if (!d.curve)
            return line(path_data);
        else
            return lineCurve(path_data);
    }

    function updateCardsSvg(svg, tree, Card, props = {}) {
        const card = d3__namespace
            .select(svg)
            .select(".cards_view")
            .selectAll("g.card_cont")
            .data(tree.data, d => d.data.id);
        const card_exit = card.exit();
        const card_enter = card.enter().append("g").attr("class", "card_cont");
        const card_update = card_enter.merge(card);
        card_exit.each(d => calculateEnterAndExitPositions(d, false, true));
        card_enter.each(d => calculateEnterAndExitPositions(d, true, false));
        card_exit.each(cardExit);
        card.each(cardUpdateNoEnter);
        card_enter.each(cardEnter);
        card_update.each(cardUpdate);
        function cardEnter(d) {
            d3__namespace.select(this)
                .attr("transform", `translate(${d._x}, ${d._y})`)
                .style("opacity", 0);
            Card.call(this, d);
        }
        function cardUpdateNoEnter(d) { }
        function cardUpdate(d) {
            Card.call(this, d);
            const delay = props.initial ? calculateDelay(tree, d, props.transition_time) : 0;
            d3__namespace.select(this).transition().duration(props.transition_time).delay(delay).attr("transform", `translate(${d.x}, ${d.y})`).style("opacity", 1);
        }
        function cardExit(d) {
            const tree_datum = d;
            const pos = tree_datum ? [tree_datum._x, tree_datum._y] : [0, 0];
            const g = d3__namespace.select(this);
            g.transition().duration(props.transition_time)
                .style("opacity", 0)
                .attr("transform", `translate(${pos[0]}, ${pos[1]})`)
                .on("end", () => g.remove());
        }
    }

    function updateCardsHtml(svg, tree, Card, props = {}) {
        const div = getHtmlDiv(svg);
        const card = d3__namespace.select(div).select(".cards_view").selectAll("div.card_cont").data(tree.data, d => d.tid);
        const card_exit = card.exit();
        const card_enter = card.enter().append("div").attr("class", "card_cont").style('pointer-events', 'none');
        const card_update = card_enter.merge(card);
        card_exit.each(d => calculateEnterAndExitPositions(d, false, true));
        card_enter.each(d => calculateEnterAndExitPositions(d, true, false));
        card_exit.each(cardExit);
        card.each(cardUpdateNoEnter);
        card_enter.each(cardEnter);
        card_update.each(cardUpdate);
        function cardEnter(d) {
            d3__namespace.select(this)
                .style('position', 'absolute')
                .style('top', '0').style('left', '0')
                .style("transform", `translate(${d._x}px, ${d._y}px)`)
                .style("opacity", 0);
            Card.call(this, d);
        }
        function cardUpdateNoEnter(d) { }
        function cardUpdate(d) {
            Card.call(this, d);
            const delay = props.initial ? calculateDelay(tree, d, props.transition_time) : 0;
            d3__namespace.select(this).transition().duration(props.transition_time).delay(delay).style("transform", `translate(${d.x}px, ${d.y}px)`).style("opacity", 1);
        }
        function cardExit(d) {
            const tree_datum = d;
            const pos = tree_datum ? [tree_datum._x, tree_datum._y] : [0, 0];
            const g = d3__namespace.select(this);
            g.transition().duration(props.transition_time)
                .style("opacity", 0)
                .style("transform", `translate(${pos[0]}px, ${pos[1]}px)`)
                .on("end", () => g.remove());
        }
        function getHtmlDiv(svg) {
            if (props.cardHtmlDiv)
                return props.cardHtmlDiv;
            const canvas = svg.closest('#f3Canvas');
            if (!canvas)
                throw new Error('canvas not found');
            const htmlSvg = canvas.querySelector('#htmlSvg');
            if (!htmlSvg)
                throw new Error('htmlSvg not found');
            return htmlSvg;
        }
    }

    function createSvg(cont, props = {}) {
        const svg_dim = cont.getBoundingClientRect();
        const svg_html = (`
    <svg class="main_svg">
      <rect width="${svg_dim.width}" height="${svg_dim.height}" fill="transparent" />
      <g class="view">
        <g class="links_view"></g>
        <g class="cards_view"></g>
      </g>
      <g style="transform: translate(100%, 100%)">
        <g class="fit_screen_icon cursor-pointer" style="transform: translate(-50px, -50px); display: none">
          <rect width="27" height="27" stroke-dasharray="${27 / 2}" stroke-dashoffset="${27 / 4}" 
            style="stroke:#fff;stroke-width:4px;fill:transparent;"/>
          <circle r="5" cx="${27 / 2}" cy="${27 / 2}" style="fill:#fff" />          
        </g>
      </g>
    </svg>
  `);
        const f3Canvas = getOrCreateF3Canvas(cont);
        const temp_div = d3__namespace.create('div').node();
        temp_div.innerHTML = svg_html;
        const svg = temp_div.querySelector('svg');
        f3Canvas.appendChild(svg);
        cont.appendChild(f3Canvas);
        setupZoom(f3Canvas, props);
        return svg;
        function getOrCreateF3Canvas(cont) {
            let f3Canvas = cont.querySelector('#f3Canvas');
            if (!f3Canvas) {
                f3Canvas = d3__namespace.create('div').attr('id', 'f3Canvas').attr('style', 'position: relative; overflow: hidden; width: 100%; height: 100%;').node();
            }
            return f3Canvas;
        }
    }

    function htmlContSetup(cont) {
        const getSvgView = () => cont.querySelector('svg .view');
        const getHtmlView = () => cont.querySelector('#htmlSvg .cards_view');
        createSvg(cont, { onZoom: onZoomSetup(getSvgView, getHtmlView) });
        createHtmlSvg(cont);
        return {
            svg: cont.querySelector('svg.main_svg'),
            svgView: cont.querySelector('svg .view'),
            htmlSvg: cont.querySelector('#htmlSvg'),
            htmlView: cont.querySelector('#htmlSvg .cards_view')
        };
    }
    function createHtmlSvg(cont) {
        const f3Canvas = d3__namespace.select(cont).select('#f3Canvas');
        const cardHtml = f3Canvas.append('div').attr('id', 'htmlSvg')
            .attr('style', 'position: absolute; width: 100%; height: 100%; z-index: 2; top: 0; left: 0');
        cardHtml.append('div').attr('class', 'cards_view').style('transform-origin', '0 0');
        return cardHtml.node();
    }
    function onZoomSetup(getSvgView, getHtmlView) {
        return function onZoom(e) {
            const t = e.transform;
            d3__namespace.select(getSvgView()).style('transform', `translate(${t.x}px, ${t.y}px) scale(${t.k}) `);
            d3__namespace.select(getHtmlView()).style('transform', `translate(${t.x}px, ${t.y}px) scale(${t.k}) `);
        };
    }

    var htmlHandlers = /*#__PURE__*/Object.freeze({
        __proto__: null,
        createHtmlSvg: createHtmlSvg,
        default: htmlContSetup,
        onZoomSetup: onZoomSetup
    });

    function cardComponentSetup(cont) {
        const getSvgView = () => cont.querySelector('svg .view');
        const getHtmlSvg = () => cont.querySelector('#htmlSvg');
        const getHtmlView = () => cont.querySelector('#htmlSvg .cards_view');
        createSvg(cont, { onZoom: onZoomSetup(getSvgView, getHtmlView) });
        d3__namespace.select(getHtmlSvg()).append("div").attr("class", "cards_view_fake").style('display', 'none'); // important for handling data
        return setupReactiveTreeData(getHtmlSvg);
    }
    function setupReactiveTreeData(getHtmlSvg) {
        let tree_data = [];
        return function getReactiveTreeData(new_tree_data) {
            const tree_data_exit = getTreeDataExit(new_tree_data, tree_data);
            tree_data = [...new_tree_data, ...tree_data_exit];
            assignUniqueIdToTreeData(getCardsViewFake(getHtmlSvg), tree_data);
            return tree_data;
        };
        function assignUniqueIdToTreeData(div, tree_data) {
            const card = d3__namespace.select(div).selectAll("div.card_cont_2fake").data(tree_data, d => d.data.id); // how this doesn't break if there is multiple cards with the same id?
            const card_exit = card.exit();
            const card_enter = card.enter().append("div").attr("class", "card_cont_2fake").style('display', 'none').attr("data-id", () => Math.random());
            const card_update = card_enter.merge(card);
            card_exit.each(cardExit);
            card_enter.each(cardEnter);
            card_update.each(cardUpdate);
            function cardEnter(d) {
                d.unique_id = d3__namespace.select(this).attr("data-id");
            }
            function cardUpdate(d) {
                d.unique_id = d3__namespace.select(this).attr("data-id");
            }
            function cardExit(d) {
                if (!d)
                    return;
                d.unique_id = d3__namespace.select(this).attr("data-id");
                d3__namespace.select(this).remove();
            }
        }
        function getTreeDataExit(new_tree_data, old_tree_data) {
            if (old_tree_data.length > 0) {
                return old_tree_data.filter(d => !new_tree_data.find(t => t.data.id === d.data.id));
            }
            else {
                return [];
            }
        }
    }
    function getCardsViewFake(getHtmlSvg) {
        return d3__namespace.select(getHtmlSvg()).select("div.cards_view_fake").node();
    }
    /** @deprecated This export will be removed in a future version. Use setupReactiveTreeData instead. */
    function setupHtmlSvg(getHtmlSvg) {
        d3__namespace.select(getHtmlSvg()).append("div").attr("class", "cards_view_fake").style('display', 'none'); // important for handling data
    }
    /** @deprecated This export will be removed in a future version. Use setupReactiveTreeData instead. */
    const _setupReactiveTreeData = setupReactiveTreeData;
    /** @deprecated This export will be removed in a future version. Use setupReactiveTreeData instead. */
    function getUniqueId(d) {
        return d.unique_id;
    }

    function updateCardsComponent(svg, tree, Card, props = {}) {
        const div = props.cardHtmlDiv ? props.cardHtmlDiv : svg.closest('#f3Canvas').querySelector('#htmlSvg');
        const card = d3__namespace.select(getCardsViewFake(() => div)).selectAll("div.card_cont_fake").data(tree.data, d => d.data.id);
        const card_exit = card.exit();
        const card_enter = card.enter().append("div").attr("class", "card_cont_fake").style('display', 'none');
        const card_update = card_enter.merge(card);
        card_exit.each(d => calculateEnterAndExitPositions(d, false, true));
        card_enter.each(d => calculateEnterAndExitPositions(d, true, false));
        card_exit.each(cardExit);
        card.each(cardUpdateNoEnter);
        card_enter.each(cardEnter);
        card_update.each(cardUpdate);
        function cardEnter(d) {
            const card_element = d3__namespace.select(Card(d));
            card_element
                .style('position', 'absolute')
                .style('top', '0').style('left', '0').style("opacity", 0)
                .style("transform", `translate(${d._x}px, ${d._y}px)`);
        }
        function cardUpdateNoEnter(d) { }
        function cardUpdate(d) {
            const card_element = d3__namespace.select(Card(d));
            const delay = props.initial ? calculateDelay(tree, d, props.transition_time) : 0;
            card_element.transition().duration(props.transition_time).delay(delay).style("transform", `translate(${d.x}px, ${d.y}px)`).style("opacity", 1);
        }
        function cardExit(d) {
            const tree_datum = d;
            const pos = tree_datum ? [tree_datum._x, tree_datum._y] : [0, 0];
            const card_element = d3__namespace.select(Card(d));
            const g = d3__namespace.select(this);
            card_element.transition().duration(props.transition_time).style("opacity", 0).style("transform", `translate(${pos[0]}px, ${pos[1]}px)`)
                .on("end", () => g.remove()); // remove the card_cont_fake
        }
    }

    function view (tree, svg, Card, props = {}) {
        props.initial = props.hasOwnProperty('initial') ? props.initial : !d3__namespace.select(svg.parentNode).select('.card_cont').node();
        props.transition_time = props.hasOwnProperty('transition_time') ? props.transition_time : 1000;
        if (props.cardComponent)
            updateCardsComponent(svg, tree, Card, props);
        else if (props.cardHtml)
            updateCardsHtml(svg, tree, Card, props);
        else
            updateCardsSvg(svg, tree, Card, props);
        updateLinks(svg, tree, props);
        const tree_position = props.tree_position || 'fit';
        if (props.initial)
            treeFit({ svg, svg_dim: svg.getBoundingClientRect(), tree_dim: tree.dim, transition_time: 0 });
        else if (tree_position === 'fit')
            treeFit({ svg, svg_dim: svg.getBoundingClientRect(), tree_dim: tree.dim, transition_time: props.transition_time });
        else if (tree_position === 'main_to_middle')
            cardToMiddle({ datum: tree.data[0], svg, svg_dim: svg.getBoundingClientRect(), scale: props.scale, transition_time: props.transition_time });
        else ;
        return true;
    }

    function cardChangeMain(store, { d }) {
        store.updateMainId(d.data.id);
        store.updateTree({});
        return true;
    }

    function checkIfRelativesConnectedWithoutPerson(datum, data_stash) {
        const r = datum.rels;
        const r_ids = [...r.parents, ...(r.spouses || []), ...(r.children || [])].filter(r_id => !!r_id);
        for (const r_id of r_ids) {
            const person = data_stash.find(d => d.id === r_id);
            if (!checkIfConnectedToFirstPerson(person, data_stash, [datum.id]))
                return false;
        }
        return true;
    }
    function checkIfConnectedToFirstPerson(datum, data_stash, exclude_ids = []) {
        const first_person = data_stash[0];
        if (datum.id === first_person.id)
            return true;
        const rels_checked = [...exclude_ids];
        let connected = false;
        checkRels(datum);
        return connected;
        function checkRels(d0) {
            if (connected)
                return;
            const r = d0.rels;
            const r_ids = [...r.parents, ...(r.spouses || []), ...(r.children || [])].filter(r_id => !!r_id);
            r_ids.forEach(r_id => {
                if (rels_checked.includes(r_id))
                    return;
                rels_checked.push(r_id);
                const person = data_stash.find(d => d.id === r_id);
                if (person.id === first_person.id)
                    connected = true;
                else
                    checkRels(person);
            });
        }
    }

    function submitFormData(datum, data_stash, form_data) {
        form_data.forEach((v, k) => datum.data[k] = v);
        syncRelReference(datum, data_stash);
        if (datum.to_add)
            delete datum.to_add;
        if (datum.unknown)
            delete datum.unknown;
    }
    function syncRelReference(datum, data_stash) {
        Object.keys(datum.data).forEach(k => {
            if (k.includes('__ref__')) {
                const rel_id = k.split('__ref__')[1];
                const rel = data_stash.find(d => d.id === rel_id);
                if (!rel)
                    return;
                const ref_field_id = k.split('__ref__')[0] + '__ref__' + datum.id;
                rel.data[ref_field_id] = datum.data[k];
            }
        });
    }
    function onDeleteSyncRelReference(datum, data_stash) {
        Object.keys(datum.data).forEach(k => {
            if (k.includes('__ref__')) {
                const rel_id = k.split('__ref__')[1];
                const rel = data_stash.find(d => d.id === rel_id);
                if (!rel)
                    return;
                const ref_field_id = k.split('__ref__')[0] + '__ref__' + datum.id;
                delete rel.data[ref_field_id];
            }
        });
    }
    function moveToAddToAdded(datum, data_stash) {
        delete datum.to_add;
        return datum;
    }
    function removeToAdd(datum, data_stash) {
        deletePerson(datum, data_stash, false);
        return false;
    }
    function deletePerson(datum, data_stash, clean_to_add = true) {
        if (!checkIfRelativesConnectedWithoutPerson(datum, data_stash)) {
            changeToUnknown();
            return { success: true };
        }
        else {
            executeDelete();
            if (clean_to_add)
                removeToAddFromData(data_stash);
            return { success: true };
        }
        function executeDelete() {
            data_stash.forEach(d => {
                for (let k in d.rels) {
                    if (!d.rels.hasOwnProperty(k))
                        continue;
                    const key = k;
                    if (Array.isArray(d.rels[key]) && d.rels[key].includes(datum.id)) {
                        d.rels[key].splice(d.rels[key].findIndex(did => did === datum.id), 1);
                    }
                }
            });
            onDeleteSyncRelReference(datum, data_stash);
            data_stash.splice(data_stash.findIndex(d => d.id === datum.id), 1);
            if (data_stash.length === 0)
                data_stash.push(createNewPerson({ data: { gender: 'M' } }));
        }
        function changeToUnknown() {
            onDeleteSyncRelReference(datum, data_stash);
            datum.data = {
                gender: datum.data.gender,
            };
            datum.unknown = true;
        }
    }
    function cleanupDataJson(data) {
        removeToAddFromData(data);
        data.forEach(d => {
            delete d.main;
            delete d._tgdp;
            delete d._tgdp_sp;
            delete d.__tgdp_sp;
        });
        data.forEach(d => {
            Object.keys(d).forEach(k => {
                if (k[0] === '_')
                    console.error('key starts with _', k);
            });
        });
        return data;
    }
    function removeToAddFromData(data) {
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].to_add)
                removeToAdd(data[i], data);
        }
    }

    function userIcon() {
        return (`
    <g data-icon="user">
      ${bgCircle()}
      <path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z" />
    </g>
  `);
    }
    function userEditIcon() {
        return (`
    <g data-icon="user-edit">
      ${bgCircle()}
      <path d="M21.7,13.35L20.7,14.35L18.65,12.3L19.65,11.3C19.86,11.09 20.21,11.09 20.42,11.3L21.7,12.58C21.91,
      12.79 21.91,13.14 21.7,13.35M12,18.94L18.06,12.88L20.11,14.93L14.06,21H12V18.94M12,14C7.58,14 4,15.79 4,
      18V20H10V18.11L14,14.11C13.34,14.03 12.67,14 12,14M12,4A4,4 0 0,0 8,8A4,4 0 0,0 12,12A4,4 0 0,0 16,8A4,4 0 0,0 12,4Z" />
    </g>
  `);
    }
    function userPlusIcon() {
        return (`
    <g data-icon="user-plus">
      ${bgCircle()}
      <path d="M15,14C12.33,14 7,15.33 7,18V20H23V18C23,15.33 17.67,14 15,14M6,10V7H4V10H1V12H4V15H6V12H9V10M15,12A4,4 0 0,0 19,8A4,4 0 0,0 15,4A4,4 0 0,0 11,8A4,4 0 0,0 15,12Z" />
    </g>
  `);
    }
    function userPlusCloseIcon() {
        return (`
    <g data-icon="user-plus-close">
      ${bgCircle()}
      <path d="M15,14C12.33,14 7,15.33 7,18V20H23V18C23,15.33 17.67,14 15,14M6,10V7H4V10H1V12H4V15H6V12H9V10M15,12A4,4 0 0,0 19,8A4,4 0 0,0 15,4A4,4 0 0,0 11,8A4,4 0 0,0 15,12Z" />
      <line x1="3" y1="3" x2="24" y2="24" stroke="currentColor" stroke-width="2" />
    </g>
  `);
    }
    function plusIcon() {
        return (`
    <g data-icon="plus">
      ${bgCircle()}
      <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
    </g>
  `);
    }
    function pencilIcon() {
        return (`
    <g data-icon="pencil">
      ${bgCircle()}
      <path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
    </g>
  `);
    }
    function pencilOffIcon() {
        return (`
    <g data-icon="pencil-off">
      ${bgCircle()}
      <path d="M18.66,2C18.4,2 18.16,2.09 17.97,2.28L16.13,4.13L19.88,7.88L21.72,6.03C22.11,5.64 22.11,5 21.72,4.63L19.38,2.28C19.18,2.09 18.91,2 18.66,2M3.28,4L2,5.28L8.5,11.75L4,16.25V20H7.75L12.25,15.5L18.72,22L20,20.72L13.5,14.25L9.75,10.5L3.28,4M15.06,5.19L11.03,9.22L14.78,12.97L18.81,8.94L15.06,5.19Z" />
    </g>
  `);
    }
    function trashIcon() {
        return (`
    <g data-icon="trash">
      ${bgCircle()}
      <path d="M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z" />
    </g>
  `);
    }
    function historyBackIcon() {
        return (`
    <g data-icon="history-back">
      ${bgCircle()}
      <path d="M20 13.5C20 17.09 17.09 20 13.5 20H6V18H13.5C16 18 18 16 18 13.5S16 9 13.5 9H7.83L10.91 12.09L9.5 13.5L4 8L9.5 2.5L10.92 3.91L7.83 7H13.5C17.09 7 20 9.91 20 13.5Z" />
    </g>
  `);
    }
    function historyForwardIcon() {
        return (`
    <g data-icon="history-forward">
      ${bgCircle()}
      <path d="M10.5 18H18V20H10.5C6.91 20 4 17.09 4 13.5S6.91 7 10.5 7H16.17L13.08 3.91L14.5 2.5L20 8L14.5 13.5L13.09 12.09L16.17 9H10.5C8 9 6 11 6 13.5S8 18 10.5 18Z" />
    </g>
  `);
    }
    function personIcon() {
        return (`
    <g data-icon="person">
      <path d="M256 288c79.5 0 144-64.5 144-144S335.5 0 256 0 112 
        64.5 112 144s64.5 144 144 144zm128 32h-55.1c-22.2 10.2-46.9 16-72.9 16s-50.6-5.8-72.9-16H128C57.3 320 0 377.3 
        0 448v16c0 26.5 21.5 48 48 48h416c26.5 0 48-21.5 48-48v-16c0-70.7-57.3-128-128-128z" />
    </g>
  `);
    }
    function miniTreeIcon() {
        return (`
    <g transform="translate(31,25)" data-icon="mini-tree">
      <rect x="-31" y="-25" width="72" height="15" fill="rgba(0,0,0,0)"></rect>
      <g>
        <rect x="-31" y="-25" width="72" height="15" fill="rgba(0,0,0,0)"></rect>
        <line y2="-17.5" stroke="#fff" />
        <line x1="-20" x2="20" y1="-17.5" y2="-17.5" stroke="#fff" />
        <rect x="-31" y="-25" width="25" height="15" rx="5" ry="5" class="card-male" />
        <rect x="6" y="-25" width="25" height="15" rx="5" ry="5" class="card-female" />
      </g>
    </g>
  `);
    }
    function toggleIconOn() {
        return (`
    <g data-icon="toggle-on">
      ${bgCircle()}
      <circle class="f3-small-circle" r="4" cx="18" cy="12" />
      <path d="M17,7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7M17,15A3,3 0 0,1 14,12A3,3 0 0,1 17,9A3,3 0 0,1 20,12A3,3 0 0,1 17,15Z" />
    </g>
  `);
    }
    function toggleIconOff() {
        return (`
    <g data-icon="toggle-off">
      ${bgCircle()}
      <circle class="f3-small-circle" r="4" cx="6" cy="12" />
      <path d="M17,7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7M7,15A3,3 0 0,1 4,12A3,3 0 0,1 7,9A3,3 0 0,1 10,12A3,3 0 0,1 7,15Z" />
    </g>
  `);
    }
    function chevronDownIcon() {
        return (`
    <g data-icon="chevron-down">
      ${bgCircle()}
      <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
    </g>
  `);
    }
    function chevronUpIcon() {
        return (`
    <g data-icon="chevron-up">
      ${bgCircle()}
      <path d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z" />
    </g>
  `);
    }
    function linkOffIcon() {
        return (`
    <g data-icon="link-off">
      ${bgCircle()}
      <path d="M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.43 19.12,14.63 17.79,15L19.25,16.44C20.88,15.61 22,13.95 
      22,12A5,5 0 0,0 17,7M16,11H13.81L15.81,13H16V11M2,4.27L5.11,7.38C3.29,8.12 2,9.91 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 
      3.9,13.71 3.9,12C3.9,10.41 5.11,9.1 6.66,8.93L8.73,11H8V13H10.73L13,15.27V17H14.73L18.74,21L20,19.74L3.27,3L2,4.27Z" />
    </g>
  `);
    }
    function infoIcon() {
        return (`
    <g data-icon="info">
      ${bgCircle()}
      <path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" />
    </g>
  `);
    }
    function userSvgIcon() { return svgWrapper(userIcon()); }
    function userEditSvgIcon() { return svgWrapper(userEditIcon()); }
    function userPlusSvgIcon() { return svgWrapper(userPlusIcon()); }
    function userPlusCloseSvgIcon() { return svgWrapper(userPlusCloseIcon()); }
    function plusSvgIcon() { return svgWrapper(plusIcon()); }
    function pencilSvgIcon() { return svgWrapper(pencilIcon()); }
    function pencilOffSvgIcon() { return svgWrapper(pencilOffIcon()); }
    function trashSvgIcon() { return svgWrapper(trashIcon()); }
    function historyBackSvgIcon() { return svgWrapper(historyBackIcon()); }
    function historyForwardSvgIcon() { return svgWrapper(historyForwardIcon()); }
    function personSvgIcon() { return svgWrapper(personIcon(), '0 0 512 512'); }
    function miniTreeSvgIcon() { return svgWrapper(miniTreeIcon(), '0 0 72 25'); }
    function toggleSvgIconOn() { return svgWrapper(toggleIconOn()); }
    function toggleSvgIconOff() { return svgWrapper(toggleIconOff()); }
    function chevronDownSvgIcon() { return svgWrapper(chevronDownIcon()); }
    function chevronUpSvgIcon() { return svgWrapper(chevronUpIcon()); }
    function linkOffSvgIcon() { return svgWrapper(linkOffIcon()); }
    function infoSvgIcon() { return svgWrapper(infoIcon()); }
    function svgWrapper(icon, viewBox = '0 0 24 24') {
        const match = icon.match(/data-icon="([^"]+)"/);
        const dataIcon = match ? `data-icon="${match[1]}"` : '';
        return (`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" style="fill: currentColor" ${dataIcon}>
      ${icon}
    </svg>
  `);
    }
    function bgCircle() {
        return (`
    <circle r="12" cx="12" cy="12" style="fill: rgba(0,0,0,0)" />
  `);
    }

    var icons = /*#__PURE__*/Object.freeze({
        __proto__: null,
        chevronDownIcon: chevronDownIcon,
        chevronDownSvgIcon: chevronDownSvgIcon,
        chevronUpIcon: chevronUpIcon,
        chevronUpSvgIcon: chevronUpSvgIcon,
        historyBackIcon: historyBackIcon,
        historyBackSvgIcon: historyBackSvgIcon,
        historyForwardIcon: historyForwardIcon,
        historyForwardSvgIcon: historyForwardSvgIcon,
        infoIcon: infoIcon,
        infoSvgIcon: infoSvgIcon,
        linkOffIcon: linkOffIcon,
        linkOffSvgIcon: linkOffSvgIcon,
        miniTreeIcon: miniTreeIcon,
        miniTreeSvgIcon: miniTreeSvgIcon,
        pencilIcon: pencilIcon,
        pencilOffIcon: pencilOffIcon,
        pencilOffSvgIcon: pencilOffSvgIcon,
        pencilSvgIcon: pencilSvgIcon,
        personIcon: personIcon,
        personSvgIcon: personSvgIcon,
        plusIcon: plusIcon,
        plusSvgIcon: plusSvgIcon,
        toggleIconOff: toggleIconOff,
        toggleIconOn: toggleIconOn,
        toggleSvgIconOff: toggleSvgIconOff,
        toggleSvgIconOn: toggleSvgIconOn,
        trashIcon: trashIcon,
        trashSvgIcon: trashSvgIcon,
        userEditIcon: userEditIcon,
        userEditSvgIcon: userEditSvgIcon,
        userIcon: userIcon,
        userPlusCloseIcon: userPlusCloseIcon,
        userPlusCloseSvgIcon: userPlusCloseSvgIcon,
        userPlusIcon: userPlusIcon,
        userPlusSvgIcon: userPlusSvgIcon,
        userSvgIcon: userSvgIcon
    });

    function getHtmlNew(form_creator) {
        return (` 
    <form id="familyForm" class="f3-form">
      ${closeBtn()}
      <h3 class="f3-form-title">${form_creator.title}</h3>
      ${genderRadio(form_creator)}

      ${fields(form_creator)}
      
      <div class="f3-form-buttons">
        <button type="button" class="f3-cancel-btn">Cancel</button>
        <button type="submit">Submit</button>
      </div>

      ${form_creator.linkExistingRelative ? addLinkExistingRelative(form_creator) : ''}
    </form>
  `);
    }
    function getHtmlEdit(form_creator) {
        return (` 
    <form id="familyForm" class="f3-form ${form_creator.editable ? '' : 'non-editable'}">
      ${closeBtn()}
      <div style="text-align: right; display: 'block'">
        ${!form_creator.no_edit ? addRelativeBtn(form_creator) : ''}
        ${form_creator.no_edit ? spaceDiv() : editBtn(form_creator)}
      </div>

      ${genderRadio(form_creator)}

      ${fields(form_creator)}
      
      <div class="f3-form-buttons">
        <button type="button" class="f3-cancel-btn">Cancel</button>
        <button type="submit">Submit</button>
      </div>

      ${form_creator.linkExistingRelative ? addLinkExistingRelative(form_creator) : ''}

      <hr>
      ${deleteBtn(form_creator)}

      ${removeRelativeBtn(form_creator)}
    </form>
  `);
    }
    function deleteBtn(form_creator) {
        return (`
    <div>
      <button type="button" class="f3-delete-btn" ${form_creator.can_delete ? '' : 'disabled'}>
        Delete
      </button>
    </div>
  `);
    }
    function removeRelativeBtn(form_creator) {
        return (`
    <div>
      <button type="button" class="f3-remove-relative-btn${form_creator.removeRelativeActive ? ' active' : ''}">
        ${form_creator.removeRelativeActive ? 'Cancel Remove Relation' : 'Remove Relation'}
      </button>
    </div>
  `);
    }
    function addRelativeBtn(form_creator) {
        return (`
    <span class="f3-add-relative-btn">
      ${form_creator.addRelativeActive ? userPlusCloseSvgIcon() : userPlusSvgIcon()}
    </span>
  `);
    }
    function editBtn(form_creator) {
        return (`
    <span class="f3-edit-btn">
      ${form_creator.editable ? pencilOffSvgIcon() : pencilSvgIcon()}
    </span>
  `);
    }
    function genderRadio(form_creator) {
        if (!form_creator.editable)
            return '';
        return (`
    <div class="f3-radio-group">
      ${form_creator.gender_field.options.map(option => (`
        <label>
          <input type="radio" name="${form_creator.gender_field.id}" 
            value="${option.value}" 
            ${option.value === form_creator.gender_field.initial_value ? 'checked' : ''}
            ${form_creator.gender_field.disabled ? 'disabled' : ''}
          >
          ${option.label}
        </label>
      `)).join('')}
    </div>
  `);
    }
    function fields(form_creator) {
        if (!form_creator.editable)
            return infoField();
        let fields_html = '';
        form_creator.fields.forEach(field => {
            if (field.type === 'text') {
                fields_html += `
      <div class="f3-form-field">
        <label>${field.label}</label>
        <input type="${field.type}" 
          name="${field.id}" 
          value="${field.initial_value || ''}"
          placeholder="${field.label}">
      </div>`;
            }
            else if (field.type === 'textarea') {
                fields_html += `
      <div class="f3-form-field">
        <label>${field.label}</label>
        <textarea name="${field.id}" 
          placeholder="${field.label}">${field.initial_value || ''}</textarea>
      </div>`;
            }
            else if (field.type === 'select') {
                const select_field = field;
                fields_html += `
      <div class="f3-form-field">
        <label>${select_field.label}</label>
        <select name="${select_field.id}" value="${select_field.initial_value || ''}">
          <option value="">${select_field.placeholder || `Select ${select_field.label}`}</option>
          ${select_field.options.map((option) => `<option ${option.value === select_field.initial_value ? 'selected' : ''} value="${option.value}">${option.label}</option>`).join('')}
        </select>
      </div>`;
            }
            else if (field.type === 'rel_reference') {
                fields_html += `
      <div class="f3-form-field">
        <label>${field.label} - <i>${field.rel_label}</i></label>
        <input type="text" 
          name="${field.id}" 
          value="${field.initial_value || ''}"
          placeholder="${field.label}">
      </div>`;
            }
        });
        return fields_html;
        function infoField() {
            let fields_html = '';
            form_creator.fields.forEach(field => {
                var _a;
                if (field.type === 'rel_reference') {
                    if (!field.initial_value)
                        return;
                    fields_html += `
        <div class="f3-info-field">
          <span class="f3-info-field-label">${field.label} - <i>${field.rel_label}</i></span>
          <span class="f3-info-field-value">${field.initial_value || ''}</span>
        </div>`;
                }
                else if (field.type === 'select') {
                    const select_field = field;
                    if (!field.initial_value)
                        return;
                    fields_html += `
        <div class="f3-info-field">
          <span class="f3-info-field-label">${select_field.label}</span>
          <span class="f3-info-field-value">${((_a = select_field.options.find(option => option.value === select_field.initial_value)) === null || _a === void 0 ? void 0 : _a.label) || ''}</span>
        </div>`;
                }
                else {
                    fields_html += `
        <div class="f3-info-field">
          <span class="f3-info-field-label">${field.label}</span>
          <span class="f3-info-field-value">${field.initial_value || ''}</span>
        </div>`;
                }
            });
            return fields_html;
        }
    }
    function addLinkExistingRelative(form_creator) {
        const title = form_creator.linkExistingRelative.hasOwnProperty('title') ? form_creator.linkExistingRelative.title : 'Profile already exists?';
        const select_placeholder = form_creator.linkExistingRelative.hasOwnProperty('select_placeholder') ? form_creator.linkExistingRelative.select_placeholder : 'Select profile';
        const options = form_creator.linkExistingRelative.options;
        return (`
    <div>
      <hr>
      <div class="f3-link-existing-relative">
        <label>${title}</label>
        <select>
          <option value="">${select_placeholder}</option>
          ${options.map(option => `<option value="${option.value}">${option.label}</option>`).join('')}
        </select>
      </div>
    </div>
  `);
    }
    function closeBtn() {
        return (`
    <span class="f3-close-btn">
      ×
    </span>
  `);
    }
    function spaceDiv() {
        return `<div style="height: 24px;"></div>`;
    }

    function createFormNew(form_creator, closeCallback) {
        return createForm(form_creator, closeCallback);
    }
    function createFormEdit(form_creator, closeCallback) {
        return createForm(form_creator, closeCallback);
    }
    function createForm(form_creator, closeCallback) {
        const is_new = isNewRelFormCreator(form_creator);
        const formContainer = document.createElement('div');
        reload();
        return formContainer;
        function reload() {
            const formHtml = is_new ? getHtmlNew(form_creator) : getHtmlEdit(form_creator);
            formContainer.innerHTML = formHtml;
            setupEventListenersBase(formContainer, form_creator, closeCallback, reload);
            if (is_new)
                setupEventListenersNew(formContainer, form_creator);
            else
                setupEventListenersEdit(formContainer, form_creator, reload);
            if (form_creator.onFormCreation) {
                form_creator.onFormCreation({
                    cont: formContainer,
                    form_creator: form_creator
                });
            }
        }
        function isNewRelFormCreator(form_creator) {
            return 'new_rel' in form_creator;
        }
    }
    function setupEventListenersBase(formContainer, form_creator, closeCallback, reload) {
        const form = formContainer.querySelector('form');
        form.addEventListener('submit', form_creator.onSubmit);
        const cancel_btn = form.querySelector('.f3-cancel-btn');
        cancel_btn.addEventListener('click', onCancel);
        const close_btn = form.querySelector('.f3-close-btn');
        close_btn.addEventListener('click', closeCallback);
        function onCancel() {
            form_creator.editable = false;
            if (form_creator.onCancel)
                form_creator.onCancel();
            reload();
        }
    }
    function setupEventListenersNew(formContainer, form_creator) {
        const form = formContainer.querySelector('form');
        const link_existing_relative_select = form.querySelector('.f3-link-existing-relative select');
        if (link_existing_relative_select) {
            link_existing_relative_select.addEventListener('change', form_creator.linkExistingRelative.onSelect);
        }
    }
    function setupEventListenersEdit(formContainer, form_creator, reload) {
        const form = formContainer.querySelector('form');
        const edit_btn = form.querySelector('.f3-edit-btn');
        if (edit_btn)
            edit_btn.addEventListener('click', onEdit);
        const delete_btn = form.querySelector('.f3-delete-btn');
        if (delete_btn && form_creator.onDelete) {
            delete_btn.addEventListener('click', form_creator.onDelete);
        }
        const add_relative_btn = form.querySelector('.f3-add-relative-btn');
        if (add_relative_btn && form_creator.addRelative) {
            add_relative_btn.addEventListener('click', () => {
                if (form_creator.addRelativeActive)
                    form_creator.addRelativeCancel();
                else
                    form_creator.addRelative();
                form_creator.addRelativeActive = !form_creator.addRelativeActive;
                reload();
            });
        }
        const remove_relative_btn = form.querySelector('.f3-remove-relative-btn');
        if (remove_relative_btn && form_creator.removeRelative) {
            remove_relative_btn.addEventListener('click', () => {
                if (form_creator.removeRelativeActive)
                    form_creator.removeRelativeCancel();
                else
                    form_creator.removeRelative();
                form_creator.removeRelativeActive = !form_creator.removeRelativeActive;
                reload();
            });
        }
        const link_existing_relative_select = form.querySelector('.f3-link-existing-relative select');
        if (link_existing_relative_select) {
            link_existing_relative_select.addEventListener('change', form_creator.linkExistingRelative.onSelect);
        }
        function onEdit() {
            form_creator.editable = !form_creator.editable;
            reload();
        }
    }

    function createHistory(store, getStoreDataCopy, onUpdate) {
        let history = [];
        let history_index = -1;
        return {
            changed,
            back,
            forward,
            canForward,
            canBack
        };
        function changed() {
            if (history_index < history.length - 1)
                history = history.slice(0, history_index + 1);
            const clean_data = getStoreDataCopy();
            clean_data.main_id = store.getMainId();
            history.push(clean_data);
            history_index++;
        }
        function back() {
            if (!canBack())
                return;
            history_index--;
            updateData(history[history_index]);
        }
        function forward() {
            if (!canForward())
                return;
            history_index++;
            updateData(history[history_index]);
        }
        function canForward() {
            return history_index < history.length - 1;
        }
        function canBack() {
            return history_index > 0;
        }
        function updateData(data) {
            const current_main_id = store.getMainId();
            data = JSON.parse(JSON.stringify(data));
            if (!data.find(d => d.id === current_main_id))
                store.updateMainId(data.main_id);
            store.updateData(data);
            onUpdate();
        }
    }
    function createHistoryControls(cont, history) {
        const history_controls = d3__namespace.select(cont).append("div").attr("class", "f3-history-controls");
        cont.insertBefore(history_controls.node(), cont.firstChild);
        const back_btn = history_controls.append("button").attr("class", "f3-back-button").on("click", () => {
            history.back();
            updateButtons();
        });
        const forward_btn = history_controls.append("button").attr("class", "f3-forward-button").on("click", () => {
            history.forward();
            updateButtons();
        });
        back_btn.html(historyBackSvgIcon());
        forward_btn.html(historyForwardSvgIcon());
        return {
            back_btn: back_btn.node(),
            forward_btn: forward_btn.node(),
            updateButtons,
            destroy
        };
        function updateButtons() {
            back_btn.classed("disabled", !history.canBack());
            forward_btn.classed("disabled", !history.canForward());
            if (!history.canBack() && !history.canForward()) {
                history_controls.style("opacity", 0).style("pointer-events", "none");
            }
            else {
                history_controls.style("opacity", 1).style("pointer-events", "auto");
            }
        }
        function destroy() {
            d3__namespace.select(cont).select('.f3-history-controls').remove();
        }
    }

    var handlers = /*#__PURE__*/Object.freeze({
        __proto__: null,
        addNewPerson: addNewPerson,
        calculateDelay: calculateDelay,
        calculateTreeFit: calculateTreeFit,
        cardChangeMain: cardChangeMain,
        cardComponentSetup: cardComponentSetup,
        cardToMiddle: cardToMiddle,
        checkIfConnectedToFirstPerson: checkIfConnectedToFirstPerson,
        checkIfRelativesConnectedWithoutPerson: checkIfRelativesConnectedWithoutPerson,
        cleanupDataJson: cleanupDataJson,
        createFormEdit: createFormEdit,
        createFormNew: createFormNew,
        createHistory: createHistory,
        createHistoryControls: createHistoryControls,
        createNewPerson: createNewPerson,
        createNewPersonWithGenderFromRel: createNewPersonWithGenderFromRel,
        deletePerson: deletePerson,
        getCurrentZoom: getCurrentZoom,
        htmlContSetup: htmlContSetup,
        isAllRelativeDisplayed: isAllRelativeDisplayed,
        manualZoom: manualZoom,
        moveToAddToAdded: moveToAddToAdded,
        onDeleteSyncRelReference: onDeleteSyncRelReference,
        removeToAdd: removeToAdd,
        removeToAddFromData: removeToAddFromData,
        setupZoom: setupZoom,
        submitFormData: submitFormData,
        syncRelReference: syncRelReference,
        treeFit: treeFit,
        zoomTo: zoomTo
    });

    function CardBody({ d, card_dim, card_display }) {
        return { template: (`
    <g class="card-body">
      <rect width="${card_dim.w}" height="${card_dim.h}" class="card-body-rect" />
      ${CardText({ d, card_dim, card_display }).template}
    </g>
  `)
        };
    }
    function CardBodyAddNewRel({ d, card_dim, label }) {
        return { template: (`
    <g class="card-body">
      <rect class="card-body-rect" width="${card_dim.w}" height="${card_dim.h}" />
      <text transform="translate(${card_dim.img_w + 5}, ${card_dim.h / 2})">
        <tspan font-size="18" dy="${8}" pointer-events="none">${label}</tspan>
      </text>
    </g>
  `)
        };
    }
    function CardText({ d, card_dim, card_display }) {
        return { template: (`
    <g>
      <g class="card-text" clip-path="url(#card_text_clip)">
        <g transform="translate(${card_dim.text_x}, ${card_dim.text_y})">
          <text>
            ${Array.isArray(card_display) ? card_display.map(cd => `<tspan x="${0}" dy="${14}">${cd(d.data)}</tspan>`).join('\n') : card_display(d.data)}
          </text>
        </g>
      </g>
      <rect width="${card_dim.w - 10}" height="${card_dim.h}" style="mask: url(#fade)" class="text-overflow-mask" /> 
    </g>
  `)
        };
    }
    function CardBodyOutline({ d, card_dim, is_new }) {
        return { template: (`
    <rect width="${card_dim.w}" height="${card_dim.h}" rx="4" ry="4" class="card-outline ${(d.data.main && !is_new) ? 'card-main-outline' : ''} ${is_new ? 'card-new-outline' : ''}" />
  `)
        };
    }
    function MiniTree({ d, card_dim }) {
        return ({ template: (`
    <g class="card_family_tree" style="cursor: pointer">
      <rect x="-31" y="-25" width="72" height="15" fill="rgba(0,0,0,0)"></rect>
      <g transform="translate(${card_dim.w * .8},6)scale(.9)">
        <rect x="-31" y="-25" width="72" height="15" fill="rgba(0,0,0,0)"></rect>
        <line y2="-17.5" stroke="#fff" />
        <line x1="-20" x2="20" y1="-17.5" y2="-17.5" stroke="#fff" />
        <rect x="-31" y="-25" width="25" height="15" rx="5" ry="5" class="card-male" />
        <rect x="6" y="-25" width="25" height="15" rx="5" ry="5" class="card-female" />
      </g>
    </g>
  `) });
    }
    function CardImage({ d, image, card_dim, maleIcon, femaleIcon }) {
        return ({ template: (`
    <g style="transform: translate(${card_dim.img_x}px,${card_dim.img_y}px);" class="card_image" clip-path="url(#card_image_clip)">
      ${image
            ? `<image href="${image}" height="${card_dim.img_h}" width="${card_dim.img_w}" preserveAspectRatio="xMidYMin slice" />`
            : (d.data.data.gender === "F" && false) ? femaleIcon({ card_dim })
                : (d.data.data.gender === "M" && false) ? maleIcon({ card_dim })
                    : GenderlessIcon()}      
    </g>
  `) });
        function GenderlessIcon() {
            return (`
      <g class="genderless-icon">
        <rect height="${card_dim.img_h}" width="${card_dim.img_w}" fill="rgb(59, 85, 96)" />
        <g transform="scale(${card_dim.img_w * 0.001616})">
         <path transform="translate(50,40)" fill="lightgrey" d="M256 288c79.5 0 144-64.5 144-144S335.5 0 256 0 112 
            64.5 112 144s64.5 144 144 144zm128 32h-55.1c-22.2 10.2-46.9 16-72.9 16s-50.6-5.8-72.9-16H128C57.3 320 0 377.3 
            0 448v16c0 26.5 21.5 48 48 48h416c26.5 0 48-21.5 48-48v-16c0-70.7-57.3-128-128-128z" />
        </g>
      </g>
    `);
        }
    }
    function appendTemplate(template, parent, is_first) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", 'g');
        g.innerHTML = template;
        if (is_first)
            parent.insertBefore(g, parent.firstChild);
        else
            parent.appendChild(g);
    }

    const CardElements = {
        miniTree,
        cardBody,
        cardImage
    };
    function miniTree(d, props) {
        if (d.data.to_add)
            return;
        const card_dim = props.card_dim;
        if (d.all_rels_displayed)
            return;
        const g = d3__namespace.create('svg:g').html(MiniTree({ d, card_dim }).template);
        g.on("click", function (e) {
            e.stopPropagation();
            if (props.onMiniTreeClick)
                props.onMiniTreeClick.call(this, e, d);
            else
                cardChangeMain(props.store, { d });
        });
        return g.node();
    }
    function cardBody(d, props) {
        const card_dim = props.card_dim;
        const g = d3__namespace.create('svg:g').html(CardBody({ d, card_dim, card_display: props.card_display }).template);
        g.on("click", function (e) {
            e.stopPropagation();
            if (props.onCardClick)
                props.onCardClick.call(this, e, d);
            else
                cardChangeMain(props.store, { d });
        });
        return g.node();
    }
    function cardImage(d, props) {
        if (d.data.to_add)
            return;
        const card_dim = props.card_dim;
        const g = d3__namespace.create('svg:g').html(CardImage({ d, image: d.data.data.avatar || null, card_dim, maleIcon: undefined, femaleIcon: undefined }).template);
        return g.node();
    }
    function appendElement(el_maybe, parent, is_first = false) {
        if (!el_maybe)
            return;
        if (is_first)
            parent.insertBefore(el_maybe, parent.firstChild);
        else
            parent.appendChild(el_maybe);
    }

    function handleCardDuplicateToggle(node, d, is_horizontal, updateTree) {
      if (!d.hasOwnProperty('_toggle')) return

      const card = node.querySelector('.card');
      const card_inner = card.querySelector('.card-inner');
      const card_width = node.querySelector('.card').offsetWidth;
      node.querySelector('.card').offsetHeight;
      let toggle_is_off;
      let toggle_id;
      const pos = {};
      if (d.spouse) {
        const spouse = d.spouse;
        const parent_id = spouse.data.main ? 'main' : spouse.parent.data.id;
        toggle_is_off = spouse.data._tgdp_sp[parent_id][d.data.id] < 0;
        pos.top = 60;
        pos.left = d.sx-d.x-30+card_width/2;
        if (is_horizontal) {
          pos.top = d.sy - d.x + 4;
          pos.left = card_width/2 + 4;
          if ((Math.abs(d.sx - d.y)) < 10) pos.left = card_width - 4;
        }
        toggle_id = spouse._toggle_id_sp ? spouse._toggle_id_sp[d.data.id] : -1;
        if (toggle_id === -1) return
      } else {
        const parent_id = d.data.main ? 'main' : d.parent.data.id;
        toggle_is_off = d.data._tgdp[parent_id] < 0;
        pos.top = -65;
        pos.left = -30+card_width/2;
        if (is_horizontal) {
          pos.top = 5;
          pos.left = -55;
        }
        toggle_id = d._toggle_id;
      }

      card_inner.style.zIndex = 1;

      const toggle_div = d3__namespace.select(card)
      .append('div')
      .attr('class', 'f3-toggle-div')
      .attr('style', 'cursor: pointer; width: 60px; height: 60px;position: absolute; z-index: -1;')
      .style('top', pos.top+'px')
      .style('left', pos.left+'px')
      .on('click', (e) => {
        e.stopPropagation();
        if (d.spouse) {
          const spouse = d.spouse;
          const parent_id = spouse.data.main ? 'main' : spouse.parent.data.id;
          if (!spouse.data._tgdp_sp[parent_id].hasOwnProperty(d.data.id)) console.error('no toggle', d, spouse);
          let val = spouse.data._tgdp_sp[parent_id][d.data.id];
          if (val < 0) val = new Date().getTime();
          else val = -new Date().getTime();
          spouse.data._tgdp_sp[parent_id][d.data.id] = val;
        } else {
          const parent_id = d.data.main ? 'main' : d.parent.data.id;
          let val = d.data._tgdp[parent_id];
          if (val < 0) val = new Date().getTime();
          else val = -new Date().getTime();
          d.data._tgdp[parent_id] = val;
        }

        updateTree();
      });

      toggle_div
      .append('div')
      .html(toggle_is_off ? toggleSvgIconOff() : toggleSvgIconOn())
      .select('svg')
      .classed('f3-toggle-icon', true)
      .style('color', toggle_is_off ? '#585656' : '#61bf52')
      .style('padding', '0');

      d3__namespace.select(card)
      .select('.f3-toggle-icon .f3-small-circle')
      .style('fill', '#fff');

      d3__namespace.select(card)
      .select('.f3-toggle-icon')
      .append('text')
      .attr('transform', toggle_is_off ? 'translate(10.6, 14.5)' : 'translate(4.1, 14.5)')
      .attr('fill', toggle_is_off ? '#fff' : '#fff')
      .attr('font-size', '7px')
      .text('C'+toggle_id);


      if (toggle_is_off) {
        let transform;
        if (d.is_ancestry) {
          if (is_horizontal) transform = 'translate(5, -30)rotate(-90)';
          else transform = 'translate(0, -10)';
        } else {
          if (is_horizontal) transform = 'translate(11, -22)rotate(90)';
          else transform = 'translate(-7, -32)rotate(180)';
        }
        d3__namespace.select(card)
        .select('.f3-toggle-div')
        .insert('div')
        .html(miniTreeSvgIcon())
        .select('svg')
        .attr('style', 'position: absolute; z-index: -1;top: 0;left: 0;border-radius: 0;')
        .style('width', '66px')
        .style('height', '112px')
        .attr('transform', transform)
        .attr('viewBox', '0 0 72 125')
        .select('line')
        .attr('y1', d.is_ancestry ? '62' : '92');
      } 
    }

    function CardHtml$2(props) {
        const cardInner = props.style === 'default' ? cardInnerDefault
            : props.style === 'imageCircleRect' ? cardInnerImageCircleRect
                : props.style === 'imageCircle' ? cardInnerImageCircle
                    : props.style === 'imageRect' ? cardInnerImageRect
                        : props.style === 'rect' ? cardInnerRect
                            : cardInnerDefault;
        return function (d) {
            this.innerHTML = (`
    <div class="card ${getClassList(d).join(' ')}" data-id="${d.tid}" style="transform: translate(-50%, -50%); pointer-events: auto;">
      ${props.mini_tree ? getMiniTree(d) : ''}
      ${(props.cardInnerHtmlCreator && !d.data._new_rel_data) ? props.cardInnerHtmlCreator(d) : cardInner(d)}
    </div>
    `);
            this.querySelector('.card').addEventListener('click', (e) => props.onCardClick(e, d));
            if (props.onCardUpdate)
                props.onCardUpdate.call(this, d);
            if (props.onCardMouseenter)
                d3__namespace.select(this).select('.card').on('mouseenter', e => props.onCardMouseenter(e, d));
            if (props.onCardMouseleave)
                d3__namespace.select(this).select('.card').on('mouseleave', e => props.onCardMouseleave(e, d));
            if (d.duplicate)
                handleCardDuplicateHover(this, d);
            if (props.duplicate_branch_toggle)
                handleCardDuplicateToggle(this, d, props.store.state.is_horizontal, props.store.updateTree);
            if (location.origin.includes('localhost')) {
                d.__node = this.querySelector('.card');
                d.__label = d.data.data['first name'];
                if (d.data.to_add) {
                    const spouse = d.spouse || d.coparent || null;
                    if (spouse)
                        d3__namespace.select(this).select('.card').attr('data-to-add', spouse.data.data['first name']);
                }
            }
        };
        function getCardInnerImageCircle(d) {
            return (`
    <div class="card-inner card-image-circle" ${getCardStyle()}>
      ${d.data.data[props.cardImageField] ? `<img src="${d.data.data[props.cardImageField]}" ${getCardImageStyle()}>` : noImageIcon(d)}
      <div class="card-label">${textDisplay(d)}</div>
      ${d.duplicate ? getCardDuplicateTag(d) : ''}
    </div>
    `);
        }
        function getCardInnerImageRect(d) {
            return (`
    <div class="card-inner card-image-rect" ${getCardStyle()}>
      ${d.data.data[props.cardImageField] ? `<img src="${d.data.data[props.cardImageField]}" ${getCardImageStyle()}>` : noImageIcon(d)}
      <div class="card-label">${textDisplay(d)}</div>
      ${d.duplicate ? getCardDuplicateTag(d) : ''}
    </div>
    `);
        }
        function getCardInnerRect(d) {
            return (`
    <div class="card-inner card-rect" ${getCardStyle()}>
      ${textDisplay(d)}
      ${d.duplicate ? getCardDuplicateTag(d) : ''}
    </div>
    `);
        }
        function textDisplay(d) {
            if (d.data._new_rel_data)
                return newRelDataDisplay(d);
            if (d.data.to_add)
                return `<div>${props.empty_card_label || 'ADD'}</div>`;
            if (d.data.unknown)
                return `<div>${props.unknown_card_label || 'UNKNOWN'}</div>`;
            return (`
      ${props.card_display.map(display => `<div>${display(d.data)}</div>`).join('')}
    `);
        }
        function newRelDataDisplay(d) {
            const attr_list = [];
            attr_list.push(`data-rel-type="${d.data._new_rel_data.rel_type}"`);
            if (['son', 'daughter'].includes(d.data._new_rel_data.rel_type))
                attr_list.push(`data-other-parent-id="${d.data._new_rel_data.other_parent_id}"`);
            return `<div ${attr_list.join(' ')}>${d.data._new_rel_data.label}</div>`;
        }
        function getMiniTree(d) {
            if (!props.mini_tree)
                return '';
            if (d.data.to_add)
                return '';
            if (d.data._new_rel_data)
                return '';
            if (d.all_rels_displayed)
                return '';
            return `<div class="mini-tree">${miniTreeSvgIcon()}</div>`;
        }
        function cardInnerImageCircleRect(d) {
            return d.data.data[props.cardImageField] ? cardInnerImageCircle(d) : cardInnerRect(d);
        }
        function cardInnerDefault(d) {
            return getCardInnerImageRect(d);
        }
        function cardInnerImageCircle(d) {
            return getCardInnerImageCircle(d);
        }
        function cardInnerImageRect(d) {
            return getCardInnerImageRect(d);
        }
        function cardInnerRect(d) {
            return getCardInnerRect(d);
        }
        function getClassList(d) {
            const class_list = [];
            if (d.data.data.gender === 'M')
                class_list.push('card-male');
            else if (d.data.data.gender === 'F')
                class_list.push('card-female');
            else
                class_list.push('card-genderless');
            class_list.push(`card-depth-${d.is_ancestry ? -d.depth : d.depth}`);
            if (d.data.main)
                class_list.push('card-main');
            if (d.data._new_rel_data)
                class_list.push('card-new-rel');
            if (d.data.to_add)
                class_list.push('card-to-add');
            if (d.data.unknown)
                class_list.push('card-unknown');
            return class_list;
        }
        function getCardStyle() {
            let style = 'style="';
            if (props.card_dim.w || props.card_dim.h) {
                style += `width: ${props.card_dim.w}px; min-height: ${props.card_dim.h}px;`;
                if (props.card_dim.height_auto)
                    style += 'height: auto;';
                else
                    style += `height: ${props.card_dim.h}px;`;
            }
            else {
                return '';
            }
            style += '"';
            return style;
        }
        function getCardImageStyle() {
            let style = 'style="position: relative;';
            if (props.card_dim.img_w || props.card_dim.img_h || props.card_dim.img_x || props.card_dim.img_y) {
                style += `width: ${props.card_dim.img_w}px; height: ${props.card_dim.img_h}px;`;
                style += `left: ${props.card_dim.img_x}px; top: ${props.card_dim.img_y}px;`;
            }
            else {
                return '';
            }
            style += '"';
            return style;
        }
        function noImageIcon(d) {
            if (d.data._new_rel_data)
                return `<div class="person-icon" ${getCardImageStyle()}>${plusSvgIcon()}</div>`;
            return `<div class="person-icon" ${getCardImageStyle()}>${props.defaultPersonIcon ? props.defaultPersonIcon(d) : personSvgIcon()}</div>`;
        }
        function getCardDuplicateTag(d) {
            return `<div class="f3-card-duplicate-tag">x${d.duplicate}</div>`;
        }
        function handleCardDuplicateHover(node, d) {
            d3__namespace.select(node).on('mouseenter', e => {
                d3__namespace.select(node.closest('.cards_view')).selectAll('.card_cont').select('.card').classed('f3-card-duplicate-hover', d0 => d0.data.id === d.data.id);
            });
            d3__namespace.select(node).on('mouseleave', e => {
                d3__namespace.select(node.closest('.cards_view')).selectAll('.card_cont').select('.card').classed('f3-card-duplicate-hover', false);
            });
        }
    }

    function setupCardSvgDefs(svg, card_dim) {
        if (svg.querySelector("defs#f3CardDef"))
            return;
        svg.insertAdjacentHTML('afterbegin', (`
      <defs id="f3CardDef">
        <linearGradient id="fadeGrad">
          <stop offset="0.9" stop-color="white" stop-opacity="0"/>
          <stop offset=".91" stop-color="white" stop-opacity=".5"/>
          <stop offset="1" stop-color="white" stop-opacity="1"/>
        </linearGradient>
        <mask id="fade" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fadeGrad)"/></mask>
        <clipPath id="card_clip"><path d="${curvedRectPath({ w: card_dim.w, h: card_dim.h }, 5)}"></clipPath>
        <clipPath id="card_text_clip"><rect width="${card_dim.w - 10}" height="${card_dim.h}"></rect></clipPath>
        <clipPath id="card_image_clip"><path d="M0,0 Q 0,0 0,0 H${card_dim.img_w} V${card_dim.img_h} H0 Q 0,${card_dim.img_h} 0,${card_dim.img_h} z"></clipPath>
        <clipPath id="card_image_clip_curved"><path d="${curvedRectPath({ w: card_dim.img_w, h: card_dim.img_h }, 5, ['rx', 'ry'])}"></clipPath>
      </defs>
    `));
        function curvedRectPath(dim, curve, no_curve_corners) {
            const { w, h } = dim, c = curve, ncc = no_curve_corners || [], ncc_check = (corner) => ncc.includes(corner), lx = ncc_check('lx') ? `M0,0` : `M0,${c} Q 0,0 5,0`, rx = ncc_check('rx') ? `H${w}` : `H${w - c} Q ${w},0 ${w},5`, ry = ncc_check('ry') ? `V${h}` : `V${h - c} Q ${w},${h} ${w - c},${h}`, ly = ncc_check('ly') ? `H0` : `H${c} Q 0,${h} 0,${h - c}`;
            return (`${lx} ${rx} ${ry} ${ly} z`);
        }
    }
    function updateCardSvgDefs(svg, card_dim) {
        if (svg.querySelector("defs#f3CardDef")) {
            svg.querySelector("defs#f3CardDef").remove();
        }
        setupCardSvgDefs(svg, card_dim);
    }

    function CardSvg$2(props) {
        props = setupProps(props);
        setupCardSvgDefs(props.svg, props.card_dim);
        return function (d) {
            const gender_class = d.data.data.gender === 'M' ? 'card-male' : d.data.data.gender === 'F' ? 'card-female' : 'card-genderless';
            const card_dim = props.card_dim;
            const card = d3__namespace.create('svg:g').attr('class', `card ${gender_class}`).attr('transform', `translate(${[-card_dim.w / 2, -card_dim.h / 2]})`);
            card.append('g').attr('class', 'card-inner').attr('clip-path', 'url(#card_clip)');
            this.innerHTML = '';
            this.appendChild(card.node());
            card.on("click", function (e) {
                e.stopPropagation();
                props.onCardClick.call(this, e, d);
            });
            if (d.data._new_rel_data) {
                appendTemplate(CardBodyOutline({ d, card_dim, is_new: d.data.to_add }).template, card.node(), true);
                appendTemplate(CardBodyAddNewRel({ d, card_dim, label: d.data._new_rel_data.label }).template, this.querySelector('.card-inner'), true);
                d3__namespace.select(this.querySelector('.card-inner'))
                    .append('g')
                    .attr('class', 'card-edit-icon')
                    .attr('fill', 'currentColor')
                    .attr('transform', `translate(-1,2)scale(${card_dim.img_h / 22})`)
                    .html(plusIcon());
            }
            else {
                appendTemplate(CardBodyOutline({ d, card_dim, is_new: d.data.to_add }).template, card.node(), true);
                appendTemplate(CardBody({ d, card_dim, card_display: props.card_display }).template, this.querySelector('.card-inner'), false);
                if (props.img)
                    appendElement(CardElements.cardImage(d, props), this.querySelector('.card'));
                if (props.mini_tree)
                    appendElement(CardElements.miniTree(d, props), this.querySelector('.card'), true);
            }
            if (props.onCardUpdate)
                props.onCardUpdate.call(this, d);
        };
        function setupProps(props) {
            const default_props = {
                img: true,
                mini_tree: true,
                link_break: false,
                card_dim: { w: 220, h: 70, text_x: 75, text_y: 15, img_w: 60, img_h: 60, img_x: 5, img_y: 5 }
            };
            if (!props)
                props = {};
            for (const k in default_props) {
                if (typeof props[k] === 'undefined')
                    props[k] = default_props[k];
            }
            return props;
        }
    }
    /**
     * @deprecated Use cardSvg instead. This export will be removed in a future version.
     */
    function Card(props) {
        if (props.onCardClick === undefined)
            props.onCardClick = (e, d) => {
                props.store.updateMainId(d.data.id);
                props.store.updateTree({});
            };
        return CardSvg$2(props);
    }

    function createInfoPopup (cont, onClose) { return new InfoPopup(cont, onClose); }
    class InfoPopup {
        constructor(cont, onClose) {
            this.cont = cont;
            this.active = false;
            this.onClose = onClose;
            this.popup_cont = d3__namespace.select(this.cont).append('div').attr('class', 'f3-popup').node();
            this.create();
        }
        create() {
            const popup = d3__namespace.select(this.popup_cont);
            popup.html(`
      <div class="f3-popup-content">
        <span class="f3-popup-close">&times;</span>
        <div class="f3-popup-content-inner"></div>
      </div>
    `);
            popup.select('.f3-popup-close').on('click', () => {
                this.close();
            });
            popup.on('click', (event) => {
                if (event.target == popup.node()) {
                    this.close();
                }
            });
        }
        activate(content) {
            const popup_content_inner = d3__namespace.select(this.popup_cont).select('.f3-popup-content-inner').node();
            if (content)
                popup_content_inner.appendChild(content);
            this.open();
        }
        open() {
            this.active = true;
        }
        close() {
            this.popup_cont.remove();
            this.active = false;
            if (this.onClose)
                this.onClose();
        }
    }

    // https://support.ancestry.co.uk/s/article/Understanding-Kinship-Terms
    function calculateKinships(d_id, data_stash, kinship_info_config) {
        const main_datum = data_stash.find(d => d.id === d_id);
        const kinships = {};
        loopCheck(main_datum.id, 'self', 0);
        setupHalfKinships(kinships);
        if (kinship_info_config.show_in_law)
            setupInLawKinships(kinships, data_stash);
        setupKinshipsGender(kinships);
        return kinships;
        function loopCheck(d_id, kinship, depth, prev_rel_id = undefined) {
            if (!d_id)
                return;
            // if (kinships[d_id] && kinships[d_id] !== kinship) console.error('kinship mismatch, kinship 1: ', kinships[d_id], 'kinship 2: ', kinship)
            if (kinships[d_id])
                return;
            if (kinship)
                kinships[d_id] = kinship;
            const datum = data_stash.find(d => d.id === d_id);
            const rels = datum.rels;
            if (kinship === 'self') {
                rels.parents.forEach(p_id => loopCheck(p_id, 'parent', depth - 1, d_id));
                (rels.spouses || []).forEach(id => loopCheck(id, 'spouse', depth));
                (rels.children || []).forEach(id => loopCheck(id, 'child', depth + 1));
            }
            else if (kinship === 'parent') {
                rels.parents.forEach(p_id => loopCheck(p_id, 'grandparent', depth - 1, d_id));
                (rels.children || []).forEach(id => {
                    if (prev_rel_id && prev_rel_id === id)
                        return;
                    loopCheck(id, 'sibling', depth + 1);
                });
            }
            else if (kinship === 'spouse') ;
            else if (kinship === 'child') {
                (rels.children || []).forEach(id => loopCheck(id, 'grandchild', depth + 1));
            }
            else if (kinship === 'sibling') {
                (rels.children || []).forEach(id => loopCheck(id, 'nephew', depth + 1));
            }
            else if (kinship === 'grandparent') {
                if (!prev_rel_id)
                    console.error(`${kinship} should have prev_rel_id`);
                rels.parents.forEach(p_id => loopCheck(p_id, 'great-grandparent', depth - 1, d_id));
                (rels.children || []).forEach(id => {
                    if (prev_rel_id && prev_rel_id === id)
                        return;
                    loopCheck(id, 'uncle', depth + 1);
                });
            }
            else if (kinship.includes('grandchild')) {
                (rels.children || []).forEach(id => loopCheck(id, getGreatKinship(kinship, depth + 1), depth + 1));
            }
            else if (kinship.includes('great-grandparent')) {
                if (!prev_rel_id)
                    console.error(`${kinship} should have prev_rel_id`);
                rels.parents.forEach(p_id => loopCheck(p_id, getGreatKinship(kinship, depth - 1), depth - 1, d_id));
                (rels.children || []).forEach(id => {
                    if (prev_rel_id && prev_rel_id === id)
                        return;
                    const great_count = getGreatCount(depth + 1);
                    if (great_count === 0)
                        loopCheck(id, 'granduncle', depth + 1);
                    else if (great_count > 0)
                        loopCheck(id, getGreatKinship('granduncle', depth + 1), depth + 1);
                    else
                        console.error(`${kinship} should have great_count > -1`);
                });
            }
            else if (kinship === 'nephew') {
                (rels.children || []).forEach(id => loopCheck(id, 'grandnephew', depth + 1));
            }
            else if (kinship.includes('grandnephew')) {
                (rels.children || []).forEach(id => loopCheck(id, getGreatKinship(kinship, depth + 1), depth + 1));
            }
            else if (kinship === 'uncle') {
                (rels.children || []).forEach(id => loopCheck(id, '1st Cousin', depth + 1));
            }
            else if (kinship === 'granduncle') {
                (rels.children || []).forEach(id => loopCheck(id, '1st Cousin 1x removed', depth + 1));
            }
            else if (kinship.includes('great-granduncle')) {
                const child_depth = depth + 1;
                const removed_count = Math.abs(child_depth);
                (rels.children || []).forEach(id => loopCheck(id, `1st Cousin ${removed_count}x removed`, child_depth));
            }
            else if (kinship.slice(4).startsWith('Cousin')) {
                (rels.children || []).forEach(id => {
                    const child_depth = depth + 1;
                    const removed_count = Math.abs(child_depth);
                    const cousin_count = +kinship[0];
                    if (child_depth === 0) {
                        loopCheck(id, `${getOrdinal(cousin_count + 1)} Cousin`, child_depth);
                    }
                    else if (child_depth < 0) {
                        loopCheck(id, `${getOrdinal(cousin_count + 1)} Cousin ${removed_count}x removed`, child_depth);
                    }
                    else if (child_depth > 0) {
                        loopCheck(id, `${getOrdinal(cousin_count)} Cousin ${removed_count}x removed`, child_depth);
                    }
                });
            }
            else
                console.error(`${kinship} not found`);
        }
        function setupHalfKinships(kinships) {
            const half_kinships = [];
            Object.keys(kinships).forEach(d_id => {
                const kinship = kinships[d_id];
                if (kinship.includes('child'))
                    return;
                if (kinship === 'spouse')
                    return;
                const same_ancestors = findSameAncestor(main_datum.id, d_id, data_stash);
                if (!same_ancestors)
                    return console.error(`${data_stash.find(d => d.id === d_id).data} not found in main_ancestry`);
                if (same_ancestors.is_half_kin)
                    half_kinships.push(d_id);
            });
            half_kinships.forEach(d_id => {
                kinships[d_id] = `Half ${kinships[d_id]}`;
            });
        }
        function setupInLawKinships(kinships, data_stash) {
            Object.keys(kinships).forEach(d_id => {
                const kinship = kinships[d_id];
                const datum = data_stash.find(d => d.id === d_id);
                if (kinship === 'spouse') {
                    const siblings = [];
                    datum.rels.parents.forEach(p_id => (getD(p_id).rels.children || []).forEach(d_id => siblings.push(d_id)));
                    siblings.forEach(sibling_id => { if (!kinships[sibling_id])
                        kinships[sibling_id] = 'sibling-in-law'; }); // gender label is added in setupKinshipsGender
                }
                if (kinship === 'sibling') {
                    (datum.rels.spouses || []).forEach(spouse_id => {
                        if (!kinships[spouse_id])
                            kinships[spouse_id] = 'sibling-in-law';
                    });
                }
                if (kinship === 'child') {
                    (datum.rels.spouses || []).forEach(spouse_id => { if (!kinships[spouse_id])
                        kinships[spouse_id] = 'child-in-law'; }); // gender label is added in setupKinshipsGender
                }
                if (kinship === 'uncle') {
                    (datum.rels.spouses || []).forEach(spouse_id => { if (!kinships[spouse_id])
                        kinships[spouse_id] = 'uncle-in-law'; }); // gender label is added in setupKinshipsGender
                }
                if (kinship.includes('Cousin')) {
                    (datum.rels.spouses || []).forEach(spouse_id => { if (!kinships[spouse_id])
                        kinships[spouse_id] = `${kinship} in-law`; }); // gender label is added in setupKinshipsGender
                }
            });
        }
        function setupKinshipsGender(kinships) {
            Object.keys(kinships).forEach(d_id => {
                const kinship = kinships[d_id];
                const datum = data_stash.find(d => d.id === d_id);
                const gender = datum.data.gender;
                if (kinship.includes('parent')) {
                    const rel_type_general = 'parent';
                    const rel_type = gender === 'M' ? 'father' : gender === 'F' ? 'mother' : rel_type_general;
                    kinships[d_id] = kinships[d_id].replace('parent', rel_type);
                }
                else if (kinship.includes('sibling')) {
                    const rel_type_general = 'sibling';
                    const rel_type = gender === 'M' ? 'brother' : gender === 'F' ? 'sister' : rel_type_general;
                    kinships[d_id] = kinships[d_id].replace('sibling', rel_type);
                }
                else if (kinship.includes('child')) {
                    const rel_type_general = 'child';
                    const rel_type = gender === 'M' ? 'son' : gender === 'F' ? 'daughter' : rel_type_general;
                    kinships[d_id] = kinships[d_id].replace('child', rel_type);
                }
                else if (kinship.includes('uncle')) {
                    const rel_type_general = 'aunt/uncle';
                    const rel_type = gender === 'M' ? 'uncle' : gender === 'F' ? 'aunt' : rel_type_general;
                    kinships[d_id] = kinships[d_id].replace('uncle', rel_type);
                }
                else if (kinship.includes('nephew')) {
                    const rel_type_general = 'neice/nephew';
                    const rel_type = gender === 'M' ? 'nephew' : gender === 'F' ? 'niece' : rel_type_general;
                    kinships[d_id] = kinships[d_id].replace('nephew', rel_type);
                }
            });
        }
        function getD(d_id) {
            return data_stash.find(d => d.id === d_id);
        }
    }
    function findSameAncestor(main_id, rel_id, data_stash) {
        const main_ancestry = getAncestry(main_id);
        let found;
        let is_ancestor;
        let is_half_kin;
        checkIfRel(rel_id);
        checkIfSpouse(rel_id);
        loopCheck(rel_id);
        if (!found)
            return null;
        return { found, is_ancestor, is_half_kin };
        function loopCheck(rel_id) {
            if (found)
                return;
            if (rel_id === main_id) {
                is_ancestor = true;
                found = rel_id;
                is_half_kin = false;
                return;
            }
            const d = data_stash.find(d => d.id === rel_id);
            const rels = d.rels;
            const parents = getParents(rels);
            const found_parent = main_ancestry.find(p => (p[0] && parents[0] && p[0] === parents[0]) || (p[1] && parents[1] && p[1] === parents[1]));
            if (found_parent) {
                found = parents.filter((p, i) => p === found_parent[i]);
                is_half_kin = checkIfHalfKin(parents, found_parent);
                return;
            }
            rels.parents.forEach(p_id => loopCheck(p_id));
        }
        function getAncestry(rel_id) {
            const ancestry = [];
            loopAdd(rel_id);
            return ancestry;
            function loopAdd(rel_id) {
                const d = data_stash.find(d => d.id === rel_id);
                const rels = d.rels;
                ancestry.push(getParents(rels));
                rels.parents.forEach(p_id => loopAdd(p_id));
            }
        }
        function getParents(rels) {
            return rels.parents;
        }
        function checkIfRel(rel_id) {
            const d = data_stash.find(d => d.id === rel_id);
            const found_parent = main_ancestry.find(p => p[0] === d.id || p[1] === d.id);
            if (found_parent) {
                is_ancestor = true;
                found = rel_id;
                is_half_kin = false;
            }
        }
        function checkIfSpouse(rel_id) {
            const main_datum = data_stash.find(d => d.id === main_id);
            if ((main_datum.rels.spouses || []).includes(rel_id)) {
                found = [main_id, rel_id];
            }
        }
        function checkIfHalfKin(ancestors1, ancestors2) {
            return ancestors1.some((p, i) => p !== ancestors2[i]) || ancestors2.some((p, i) => p !== ancestors1[i]);
        }
    }
    function getOrdinal(n) {
        const s = ['st', 'nd', 'rd'];
        return s[n - 1] ? n + s[n - 1] : n + 'th';
    }
    function getGreatCount(depth) {
        const depth_abs = Math.abs(depth);
        return depth_abs - 2;
    }
    function getGreatKinship(kinship, depth) {
        const great_count = getGreatCount(depth);
        if (kinship.includes('great-'))
            kinship = kinship.split('great-')[1];
        if (great_count === 1) {
            return `great-${kinship}`;
        }
        else if (great_count > 1) {
            return `${great_count}x-great-${kinship}`;
        }
        else {
            console.error(`${kinship} should have great_count > 1`);
            return kinship;
        }
    }

    function getKinshipsDataStash(main_id, rel_id, data_stash, kinships) {
        var _a;
        let in_law_id;
        const kinship = kinships[rel_id].toLowerCase();
        if (kinship.includes('in-law')) {
            in_law_id = rel_id;
            const datum = data_stash.find(d => d.id === in_law_id);
            if (kinship.includes('sister') || kinship.includes('brother')) {
                rel_id = main_id;
            }
            else {
                rel_id = (_a = datum.rels.spouses) === null || _a === void 0 ? void 0 : _a.find(d_id => kinships[d_id] && !kinships[d_id].includes('in-law'));
            }
        }
        const same_ancestors = findSameAncestor(main_id, rel_id, data_stash);
        if (!same_ancestors)
            return console.error(`${rel_id} not found in main_ancestry`);
        const same_ancestor_id = same_ancestors.is_ancestor ? same_ancestors.found : same_ancestors.found[0];
        const same_ancestor = data_stash.find(d => d.id === same_ancestor_id);
        const root = d3__namespace.hierarchy(same_ancestor, hierarchyGetterChildren);
        const same_ancestor_progeny = root.descendants().map(d => d.data.id);
        const main_ancestry = getCleanAncestry(main_id, same_ancestor_progeny);
        const rel_ancestry = getCleanAncestry(rel_id, same_ancestor_progeny);
        loopClean(root);
        const kinship_data_stash = root.descendants().map(d => {
            const datum = {
                id: d.data.id,
                data: JSON.parse(JSON.stringify(d.data.data)),
                kinship: kinships[d.data.id],
                rels: {
                    parents: [],
                    spouses: [],
                    children: []
                }
            };
            if (d.children && d.children.length > 0)
                datum.rels.children = d.children.map(c => c.data.id);
            return datum;
        });
        if (kinship_data_stash.length > 0 && !same_ancestors.is_ancestor && !same_ancestors.is_half_kin)
            addRootSpouse(kinship_data_stash);
        if (in_law_id)
            addInLawConnection(kinship_data_stash);
        return kinship_data_stash;
        function loopClean(tree_datum) {
            tree_datum.children = (tree_datum.children || []).filter(child => {
                if (main_ancestry.includes(child.data.id))
                    return true;
                if (rel_ancestry.includes(child.data.id))
                    return true;
                return false;
            });
            tree_datum.children.forEach(child => loopClean(child));
            if (tree_datum.children.length === 0)
                delete tree_datum.children;
        }
        function hierarchyGetterChildren(d) {
            const children = [...(d.rels.children || [])].map(id => data_stash.find(d => d.id === id)).filter(d => d);
            return children;
        }
        function getCleanAncestry(d_id, same_ancestor_progeny) {
            const ancestry = [d_id];
            loopAdd(d_id);
            return ancestry;
            function loopAdd(d_id) {
                const d = data_stash.find(d => d.id === d_id);
                const rels = d.rels;
                rels.parents.forEach(p_id => {
                    if (same_ancestor_progeny.includes(p_id)) {
                        ancestry.push(p_id);
                        loopAdd(p_id);
                    }
                });
            }
        }
        function addRootSpouse(kinship_data_stash) {
            const datum = kinship_data_stash[0];
            if (!same_ancestors)
                return console.error(`${rel_id} not found in main_ancestry`);
            const spouse_id = same_ancestor_id === same_ancestors.found[0] ? same_ancestors.found[1] : same_ancestors.found[0];
            datum.rels.spouses = [spouse_id];
            const spouse = data_stash.find(d => d.id === spouse_id);
            const spouse_datum = {
                id: spouse.id,
                data: JSON.parse(JSON.stringify(spouse.data)),
                kinship: kinships[spouse.id],
                rels: {
                    spouses: [datum.id],
                    children: datum.rels.children,
                    parents: []
                }
            };
            kinship_data_stash.push(spouse_datum);
            (datum.rels.children || []).forEach(child_id => {
                const child = data_stash.find(d => d.id === child_id);
                const kinship_child = kinship_data_stash.find(d => d.id === child_id);
                kinship_child.rels.parents = [...child.rels.parents];
            });
        }
        function addInLawConnection(kinship_data_stash) {
            if (kinship.includes('sister') || kinship.includes('brother')) {
                addInLawSibling(kinship_data_stash);
            }
            else {
                addInLawSpouse(kinship_data_stash);
            }
        }
        function addInLawSpouse(kinship_data_stash) {
            const datum = kinship_data_stash.find(d => d.id === rel_id);
            const spouse_id = in_law_id;
            datum.rels.spouses = [spouse_id];
            const spouse = data_stash.find(d => d.id === spouse_id);
            const spouse_datum = {
                id: spouse.id,
                data: JSON.parse(JSON.stringify(spouse.data)),
                kinship: kinships[spouse.id],
                rels: {
                    spouses: [datum.id],
                    children: [],
                    parents: []
                }
            };
            kinship_data_stash.push(spouse_datum);
        }
        function addInLawSibling(kinship_data_stash) {
            var _a;
            const datum = kinship_data_stash.find(d => d.id === rel_id);
            const in_law_datum = getD(in_law_id);
            kinship_data_stash.push({
                id: in_law_id,
                data: JSON.parse(JSON.stringify(in_law_datum.data)),
                kinship: kinships[in_law_id],
                rels: {
                    spouses: [],
                    children: [],
                    parents: []
                }
            });
            const siblings = [];
            in_law_datum.rels.parents.forEach(p_id => (getD(p_id).rels.children || []).forEach(d_id => siblings.push(d_id)));
            const spouse_id = (_a = getD(rel_id).rels.spouses) === null || _a === void 0 ? void 0 : _a.find(d_id => siblings.includes(d_id));
            datum.rels.spouses = [spouse_id];
            const spouse = getD(spouse_id);
            const spouse_datum = {
                id: spouse.id,
                data: JSON.parse(JSON.stringify(spouse.data)),
                kinship: kinships[spouse.id],
                rels: {
                    spouses: [datum.id],
                    children: [],
                    parents: []
                }
            };
            kinship_data_stash.push(spouse_datum);
            in_law_datum.rels.parents.forEach(p_id => {
                const parent = getD(p_id);
                const kinship_label = parent.data.gender === 'M' ? 'Father-in-law' : parent.data.gender === 'F' ? 'Mother-in-law' : 'Parent-in-law';
                const parent_datum = {
                    id: parent.id,
                    data: JSON.parse(JSON.stringify(parent.data)),
                    kinship: kinship_label,
                    rels: {
                        spouses: [],
                        children: [spouse_id, in_law_id],
                        parents: []
                    }
                };
                const p2_id = in_law_datum.rels.parents.find(p_id => p_id !== p_id);
                if (p2_id)
                    parent_datum.rels.parents.push(p2_id);
                kinship_data_stash.unshift(parent_datum);
            });
        }
        function getD(d_id) {
            return data_stash.find(d => d.id === d_id);
        }
    }

    function handleLinkRel(updated_datum, link_rel_id, store_data) {
        const new_rel_id = updated_datum.id;
        store_data.forEach(d => {
            if (d.rels.parents.includes(new_rel_id)) {
                d.rels.parents[d.rels.parents.indexOf(new_rel_id)] = link_rel_id;
            }
            if (d.rels.spouses && d.rels.spouses.includes(new_rel_id)) {
                d.rels.spouses = d.rels.spouses.filter(id => id !== new_rel_id);
                if (!d.rels.spouses.includes(link_rel_id))
                    d.rels.spouses.push(link_rel_id);
            }
            if (d.rels.children && d.rels.children.includes(new_rel_id)) {
                d.rels.children = d.rels.children.filter(id => id !== new_rel_id);
                if (!d.rels.children.includes(link_rel_id))
                    d.rels.children.push(link_rel_id);
            }
        });
        const link_rel = store_data.find(d => d.id === link_rel_id);
        const new_rel = store_data.find(d => d.id === new_rel_id);
        if (!new_rel)
            throw new Error('New rel not found');
        if (!link_rel)
            throw new Error('Link rel not found');
        (new_rel.rels.children || []).forEach(child_id => {
            if (!link_rel.rels.children)
                link_rel.rels.children = [];
            if (!link_rel.rels.children.includes(child_id))
                link_rel.rels.children.push(child_id);
        });
        (new_rel.rels.spouses || []).forEach(spouse_id => {
            if (!link_rel.rels.spouses)
                link_rel.rels.spouses = [];
            if (!link_rel.rels.spouses.includes(spouse_id))
                link_rel.rels.spouses.push(spouse_id);
        });
        if (link_rel.rels.parents.length === 0) {
            link_rel.rels.parents = [...new_rel.rels.parents];
        }
        else {
            const link_rel_father = link_rel.rels.parents.find(id => { var _a; return ((_a = store_data.find(d => d.id === id)) === null || _a === void 0 ? void 0 : _a.data.gender) === "M"; });
            const link_rel_mother = link_rel.rels.parents.find(id => { var _a; return ((_a = store_data.find(d => d.id === id)) === null || _a === void 0 ? void 0 : _a.data.gender) === "F"; });
            const new_rel_father = new_rel.rels.parents.find(id => { var _a; return ((_a = store_data.find(d => d.id === id)) === null || _a === void 0 ? void 0 : _a.data.gender) === "M"; });
            const new_rel_mother = new_rel.rels.parents.find(id => { var _a; return ((_a = store_data.find(d => d.id === id)) === null || _a === void 0 ? void 0 : _a.data.gender) === "F"; });
            if (new_rel_father) {
                if (link_rel_father) {
                    console.error('link rel already has father');
                    link_rel.rels.parents[link_rel.rels.parents.indexOf(link_rel_father)] = new_rel_father;
                }
                else
                    link_rel.rels.parents.push(new_rel_father);
            }
            if (new_rel_mother) {
                if (link_rel_mother) {
                    console.error('link rel already has mother');
                    link_rel.rels.parents[link_rel.rels.parents.indexOf(link_rel_mother)] = new_rel_mother;
                }
                else
                    link_rel.rels.parents.push(new_rel_mother);
            }
        }
        store_data.splice(store_data.findIndex(d => d.id === new_rel_id), 1);
    }
    function getLinkRelOptions(datum, data) {
        const rel_datum = datum._new_rel_data ? data.find(d => d.id === datum._new_rel_data.rel_id) : null;
        const ancestry_ids = getAncestry(datum, data);
        const progeny_ids = getProgeny(datum, data);
        if (datum._new_rel_data && ['son', 'daughter'].includes(datum._new_rel_data.rel_type)) {
            if (!rel_datum)
                throw new Error('Rel datum not found');
            progeny_ids.push(...getProgeny(rel_datum, data));
        }
        return data.filter(d => d.id !== datum.id && d.id !== (rel_datum === null || rel_datum === void 0 ? void 0 : rel_datum.id) && !d._new_rel_data && !d.to_add && !d.unknown)
            .filter(d => !ancestry_ids.includes(d.id))
            .filter(d => !progeny_ids.includes(d.id))
            .filter(d => !(d.rels.spouses || []).includes(datum.id));
        function getAncestry(datum, data_stash) {
            const ancestry_ids = [];
            loopCheck(datum);
            return ancestry_ids;
            function loopCheck(d) {
                d.rels.parents.forEach(p_id => {
                    if (p_id) {
                        ancestry_ids.push(p_id);
                        const parent = data_stash.find(d => d.id === p_id);
                        if (!parent)
                            throw new Error('Parent not found');
                        loopCheck(parent);
                    }
                });
            }
        }
        function getProgeny(datum, data_stash) {
            const progeny_ids = [];
            loopCheck(datum);
            return progeny_ids;
            function loopCheck(d) {
                const children = d.rels.children ? [...d.rels.children] : [];
                children.forEach(c_id => {
                    progeny_ids.push(c_id);
                    const child = data_stash.find(d => d.id === c_id);
                    if (!child)
                        throw new Error('Child not found');
                    loopCheck(child);
                });
            }
        }
    }

    function formCreatorSetup({ datum, store, fields, postSubmitHandler, addRelative, removeRelative, deletePerson, onCancel, editFirst, link_existing_rel_config, onFormCreation, no_edit, onSubmit, onDelete, canEdit, canDelete, }) {
        let can_delete = canDelete ? canDelete(datum) : true;
        const can_edit = canEdit ? canEdit(datum) : true;
        if (!can_edit) {
            no_edit = true;
            can_delete = false;
        }
        let form_creator;
        const base_form_creator = {
            datum_id: datum.id,
            fields: [],
            onSubmit: submitFormChanges,
            onCancel: onCancel,
            onFormCreation: onFormCreation,
            no_edit: no_edit,
            gender_field: getGenderField(),
        };
        // Existing datum form creator
        if (!datum._new_rel_data) {
            if (!addRelative)
                throw new Error('addRelative is required');
            if (!removeRelative)
                throw new Error('removeRelative is required');
            form_creator = Object.assign(Object.assign({}, base_form_creator), { onDelete: deletePersonWithPostSubmit, addRelative: () => addRelative.activate(datum), addRelativeCancel: () => addRelative.onCancel(), addRelativeActive: addRelative.is_active, removeRelative: () => removeRelative.activate(datum), removeRelativeCancel: () => removeRelative.onCancel(), removeRelativeActive: removeRelative.is_active, editable: false, can_delete: can_delete });
        }
        // New rel form creator
        else {
            form_creator = Object.assign(Object.assign({}, base_form_creator), { title: datum._new_rel_data.label, new_rel: true, editable: true });
        }
        if (datum._new_rel_data || datum.to_add || datum.unknown) {
            if (link_existing_rel_config)
                form_creator.linkExistingRelative = createLinkExistingRelative(datum, store.getData(), link_existing_rel_config);
        }
        if (no_edit)
            form_creator.editable = false;
        else if (editFirst)
            form_creator.editable = true;
        fields.forEach(field => {
            if (field.type === 'rel_reference')
                addRelReferenceField(field);
            else if (field.type === 'select')
                addSelectField(field);
            else
                form_creator.fields.push({
                    id: field.id,
                    type: field.type,
                    label: field.label,
                    initial_value: datum.data[field.id],
                });
        });
        return form_creator;
        function getGenderField() {
            return {
                id: 'gender',
                type: 'switch',
                label: 'Gender',
                initial_value: datum.data.gender,
                disabled: false,
                options: [{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]
            };
        }
        function addRelReferenceField(field) {
            if (!field.getRelLabel)
                console.error('getRelLabel is not set');
            if (field.rel_type === 'spouse') {
                (datum.rels.spouses || []).forEach(spouse_id => {
                    const spouse = store.getDatum(spouse_id);
                    if (!spouse)
                        throw new Error('Spouse not found');
                    const marriage_date_id = `${field.id}__ref__${spouse_id}`;
                    const rel_reference_field = {
                        id: marriage_date_id,
                        type: 'rel_reference',
                        label: field.label,
                        rel_id: spouse_id,
                        rel_label: field.getRelLabel(spouse),
                        initial_value: datum.data[marriage_date_id],
                        rel_type: field.rel_type,
                    };
                    form_creator.fields.push(rel_reference_field);
                });
            }
        }
        function addSelectField(field) {
            if (!field.options && !field.optionCreator)
                return console.error('optionCreator or options is not set for field', field);
            const select_field = {
                id: field.id,
                type: field.type,
                label: field.label,
                initial_value: datum.data[field.id],
                placeholder: field.placeholder,
                options: field.options || field.optionCreator(datum),
            };
            form_creator.fields.push(select_field);
        }
        function createLinkExistingRelative(datum, data, link_existing_rel_config) {
            if (!link_existing_rel_config)
                throw new Error('link_existing_rel_config is required');
            const obj = {
                title: link_existing_rel_config.title,
                select_placeholder: link_existing_rel_config.select_placeholder,
                options: getLinkRelOptions(datum, data)
                    .map((d) => ({ value: d.id, label: link_existing_rel_config.linkRelLabel(d) }))
                    .sort((a, b) => {
                    if (typeof a.label === 'string' && typeof b.label === 'string')
                        return a.label.localeCompare(b.label);
                    else
                        return a.label < b.label ? -1 : 1;
                }),
                onSelect: submitLinkExistingRelative
            };
            return obj;
        }
        function submitFormChanges(e) {
            if (onSubmit) {
                onSubmit(e, datum, applyChanges, () => postSubmitHandler({}));
            }
            else {
                e.preventDefault();
                applyChanges();
                postSubmitHandler({});
            }
            function applyChanges() {
                const form_data = new FormData(e.target);
                submitFormData(datum, store.getData(), form_data);
            }
        }
        function submitLinkExistingRelative(e) {
            const link_rel_id = e.target.value;
            postSubmitHandler({ link_rel_id: link_rel_id });
        }
        function deletePersonWithPostSubmit() {
            if (onDelete) {
                onDelete(datum, () => deletePerson(), () => postSubmitHandler({ delete: true }));
            }
            else {
                deletePerson();
                postSubmitHandler({ delete: true });
            }
        }
    }

    function updateGendersForNewRelatives(updated_datum, data) {
        // if gender on main datum is changed, we need to switch mother/father ids for new children
        data.forEach(d => {
            const rd = d._new_rel_data;
            if (!rd)
                return;
            if (rd.rel_type === 'spouse')
                d.data.gender = d.data.gender === 'M' ? 'F' : 'M';
        });
    }
    function cleanUp(data) {
        for (let i = data.length - 1; i >= 0; i--) {
            const d = data[i];
            if (d._new_rel_data) {
                data.forEach(d2 => {
                    if (d2.rels.parents.includes(d.id))
                        d2.rels.parents.splice(d2.rels.parents.indexOf(d.id), 1);
                    if (d2.rels.children && d2.rels.children.includes(d.id))
                        d2.rels.children.splice(d2.rels.children.indexOf(d.id), 1);
                    if (d2.rels.spouses && d2.rels.spouses.includes(d.id))
                        d2.rels.spouses.splice(d2.rels.spouses.indexOf(d.id), 1);
                });
                data.splice(i, 1);
            }
        }
    }
    function addDatumRelsPlaceholders(datum, store_data, addRelLabels, canAdd) {
        let can_add = { parent: true, spouse: true, child: true };
        if (canAdd)
            can_add = Object.assign(can_add, canAdd(datum));
        if (!datum.rels.spouses)
            datum.rels.spouses = [];
        if (!datum.rels.children)
            datum.rels.children = [];
        if (can_add.parent)
            addParents();
        if (can_add.spouse) {
            addSpouseForSingleParentChildren();
            addSpouse();
        }
        if (can_add.child)
            addChildren();
        function addParents() {
            const parents = datum.rels.parents;
            const father = parents.find(d_id => { var _a; return ((_a = store_data.find(d => d.id === d_id)) === null || _a === void 0 ? void 0 : _a.data.gender) === "M"; });
            const mother = parents.find(d_id => { var _a; return ((_a = store_data.find(d => d.id === d_id)) === null || _a === void 0 ? void 0 : _a.data.gender) === "F"; });
            if (parents.length < 2 && !father) {
                const father = createNewPerson({ data: { gender: "M" }, rels: { children: [datum.id] } });
                father._new_rel_data = { rel_type: "father", label: addRelLabels.father, rel_id: datum.id };
                datum.rels.parents.push(father.id);
                store_data.push(father);
            }
            if (parents.length < 2 && !mother) {
                const mother = createNewPerson({ data: { gender: "F" }, rels: { children: [datum.id] } });
                mother._new_rel_data = { rel_type: "mother", label: addRelLabels.mother, rel_id: datum.id };
                datum.rels.parents.push(mother.id);
                store_data.push(mother);
            }
            const p1 = store_data.find(d => d.id === datum.rels.parents[0]);
            const p2 = store_data.find(d => d.id === datum.rels.parents[1]);
            if (!p1.rels.spouses)
                p1.rels.spouses = [];
            if (!p2.rels.spouses)
                p2.rels.spouses = [];
            if (!p1.rels.spouses.includes(p2.id))
                p1.rels.spouses.push(p2.id);
            if (!p2.rels.spouses.includes(p1.id))
                p2.rels.spouses.push(p1.id);
            if (!p1.rels.children)
                p1.rels.children = [];
            if (!p2.rels.children)
                p2.rels.children = [];
            if (!p1.rels.children.includes(datum.id))
                p1.rels.children.push(datum.id);
            if (!p2.rels.children.includes(datum.id))
                p2.rels.children.push(datum.id);
        }
        function addSpouseForSingleParentChildren() {
            if (!datum.rels.spouses)
                datum.rels.spouses = [];
            if (datum.rels.children) {
                let new_spouse;
                datum.rels.children.forEach(child_id => {
                    const child = store_data.find(d => d.id === child_id);
                    if (child.rels.parents.length === 1) {
                        const p1 = store_data.find(d => d.id === child.rels.parents[0]);
                        const new_spouse_gender = p1.data.gender === "M" ? "F" : "M";
                        if (!new_spouse)
                            new_spouse = createNewPerson({ data: { gender: new_spouse_gender }, rels: { spouses: [datum.id] } });
                        new_spouse._new_rel_data = { rel_type: "spouse", label: addRelLabels.spouse, rel_id: datum.id };
                        new_spouse.rels.children.push(child.id);
                        datum.rels.spouses.push(new_spouse.id);
                        child.rels.parents.push(new_spouse.id);
                        store_data.push(new_spouse);
                    }
                });
            }
        }
        function addSpouse() {
            if (!datum.rels.spouses)
                datum.rels.spouses = [];
            const spouse_gender = datum.data.gender === "M" ? "F" : "M";
            const new_spouse = createNewPerson({ data: { gender: spouse_gender }, rels: { spouses: [datum.id] } });
            new_spouse._new_rel_data = { rel_type: "spouse", label: addRelLabels.spouse, rel_id: datum.id };
            datum.rels.spouses.push(new_spouse.id);
            store_data.push(new_spouse);
        }
        function addChildren() {
            if (!datum.rels.children)
                datum.rels.children = [];
            if (!datum.rels.spouses)
                datum.rels.spouses = [];
            datum.rels.spouses.forEach(spouse_id => {
                const spouse = store_data.find(d => d.id === spouse_id);
                if (!spouse.rels.children)
                    spouse.rels.children = [];
                const new_son = createNewPerson({ data: { gender: "M" }, rels: { parents: [datum.id, spouse.id] } });
                new_son._new_rel_data = { rel_type: "son", label: addRelLabels.son, other_parent_id: spouse.id, rel_id: datum.id };
                spouse.rels.children.push(new_son.id);
                datum.rels.children.push(new_son.id);
                store_data.push(new_son);
                const new_daughter = createNewPerson({ data: { gender: "F" }, rels: { parents: [datum.id, spouse.id] } });
                new_daughter._new_rel_data = { rel_type: "daughter", label: addRelLabels.daughter, other_parent_id: spouse.id, rel_id: datum.id };
                spouse.rels.children.push(new_daughter.id);
                datum.rels.children.push(new_daughter.id);
                store_data.push(new_daughter);
            });
        }
        return store_data;
    }

    var addRelative = (store, onActivate, cancelCallback) => { return new AddRelative(store, onActivate, cancelCallback); };
    class AddRelative {
        constructor(store, onActivate, cancelCallback) {
            this.store = store;
            this.onActivate = onActivate;
            this.cancelCallback = cancelCallback;
            this.datum = null;
            this.onChange = null;
            this.onCancel = null;
            this.is_active = false;
            this.addRelLabels = this.addRelLabelsDefault();
            return this;
        }
        activate(datum) {
            if (this.is_active)
                this.onCancel();
            this.onActivate();
            this.is_active = true;
            this.store.state.one_level_rels = true;
            const store = this.store;
            this.datum = datum;
            let gender_stash = this.datum.data.gender;
            addDatumRelsPlaceholders(datum, this.getStoreData(), this.addRelLabels, this.canAdd);
            store.updateTree({});
            this.onChange = onChange;
            this.onCancel = () => onCancel(this);
            function onChange(updated_datum, props) {
                if (updated_datum === null || updated_datum === void 0 ? void 0 : updated_datum._new_rel_data) {
                    if (props === null || props === void 0 ? void 0 : props.link_rel_id)
                        handleLinkRel(updated_datum, props.link_rel_id, store.getData());
                    else
                        delete updated_datum._new_rel_data;
                }
                else if (updated_datum.id === datum.id) {
                    if (updated_datum.data.gender !== gender_stash) {
                        gender_stash = updated_datum.data.gender;
                        updateGendersForNewRelatives(updated_datum, store.getData());
                    }
                }
                else {
                    console.error('Something went wrong');
                }
            }
            function onCancel(self) {
                if (!self.is_active)
                    return;
                self.is_active = false;
                self.store.state.one_level_rels = false;
                self.cleanUp();
                self.cancelCallback(self.datum);
                self.datum = null;
                self.onChange = null;
                self.onCancel = null;
            }
        }
        setAddRelLabels(add_rel_labels) {
            if (typeof add_rel_labels !== 'object') {
                console.error('add_rel_labels must be an object');
                return;
            }
            for (const key in add_rel_labels) {
                const key_str = key;
                this.addRelLabels[key_str] = add_rel_labels[key_str];
            }
            return this;
        }
        setCanAdd(canAdd) {
            this.canAdd = canAdd;
            return this;
        }
        addRelLabelsDefault() {
            return {
                father: 'Add Father',
                mother: 'Add Mother',
                spouse: 'Add Spouse',
                son: 'Add Son',
                daughter: 'Add Daughter'
            };
        }
        getStoreData() {
            return this.store.getData();
        }
        cleanUp(data) {
            if (!data)
                data = this.store.getData();
            cleanUp(data);
            return data;
        }
    }

    var removeRelative = (store, onActivate, cancelCallback, modal) => { return new RemoveRelative(store, onActivate, cancelCallback, modal); };
    class RemoveRelative {
        constructor(store, onActivate, cancelCallback, modal) {
            this.store = store;
            this.onActivate = onActivate;
            this.cancelCallback = cancelCallback;
            this.modal = modal;
            this.datum = null;
            this.onChange = null;
            this.onCancel = null;
            this.is_active = false;
            return this;
        }
        activate(datum) {
            if (this.is_active)
                this.onCancel();
            this.onActivate();
            this.is_active = true;
            this.store.state.one_level_rels = true;
            const store = this.store;
            store.updateTree({});
            this.datum = datum;
            this.onChange = onChange.bind(this);
            this.onCancel = onCancel.bind(this);
            function onChange(rel_tree_datum, onAccept) {
                const rel_type = findRelType(rel_tree_datum);
                const rels = datum.rels;
                if (rel_type === 'parent')
                    handleParentRemoval.call(this);
                else if (rel_type === 'spouse')
                    handleSpouseRemoval.call(this);
                else if (rel_type === 'children')
                    handleChildrenRemoval.call(this);
                function handleParentRemoval() {
                    const rel_id = rel_tree_datum.data.id;
                    const parent = store.getDatum(rel_id);
                    if (!parent)
                        throw new Error('Parent not found');
                    if (!parent.rels.children)
                        throw new Error('Parent has no children');
                    parent.rels.children = parent.rels.children.filter(id => id !== datum.id);
                    rels.parents = rels.parents.filter(id => id !== rel_id);
                    onAccept();
                }
                function handleSpouseRemoval() {
                    const spouse = rel_tree_datum.data;
                    if (checkIfChildrenWithSpouse())
                        openModal.call(this);
                    else
                        remove.call(this, true);
                    function checkIfChildrenWithSpouse() {
                        const children = spouse.rels.children || [];
                        return children.some(ch_id => {
                            const child = store.getDatum(ch_id);
                            if (!child)
                                throw new Error('Child not found');
                            if (child.rels.parents.includes(spouse.id))
                                return true;
                            return false;
                        });
                    }
                    function openModal() {
                        const current_gender_class = datum.data.gender === 'M' ? 'f3-male-bg' : datum.data.gender === 'F' ? 'f3-female-bg' : null;
                        const spouse_gender_class = spouse.data.gender === 'M' ? 'f3-male-bg' : spouse.data.gender === 'F' ? 'f3-female-bg' : null;
                        const div = d3__namespace.create('div').html(`
            <p>You are removing a spouse relationship. Since there are shared children, please choose which parent should keep them in the family tree.</p>
            <div class="f3-modal-options">
              <button data-option="assign-to-current" class="f3-btn ${current_gender_class}">Keep children with current person</button>
              <button data-option="assign-to-spouse" class="f3-btn ${spouse_gender_class}">Keep children with spouse</button>
            </div>
          `);
                        div.selectAll('[data-option="assign-to-current"]').on('click', () => {
                            remove(true);
                            this.modal.close();
                        });
                        div.selectAll('[data-option="assign-to-spouse"]').on('click', () => {
                            remove(false);
                            this.modal.close();
                        });
                        this.modal.activate(div.node());
                    }
                    function remove(to_current) {
                        rel_tree_datum.data.rels.spouses = rel_tree_datum.data.rels.spouses.filter(id => id !== datum.id);
                        rels.spouses = rels.spouses.filter(id => id !== rel_tree_datum.data.id);
                        const childrens_parent = to_current ? datum : rel_tree_datum.data;
                        const other_parent = to_current ? rel_tree_datum.data : datum;
                        (rels.children || []).forEach(id => {
                            const child = store.getDatum(id);
                            if (!child)
                                throw new Error('Child not found');
                            if (child.rels.parents.includes(other_parent.id))
                                child.rels.parents = child.rels.parents.filter(id => id !== other_parent.id);
                        });
                        if (other_parent.rels.children) {
                            other_parent.rels.children = other_parent.rels.children.filter(ch_id => !(childrens_parent.rels.children || []).includes(ch_id));
                        }
                        onAccept();
                    }
                }
                function handleChildrenRemoval() {
                    if (!rels.children)
                        throw new Error('Children not found');
                    rels.children = rels.children.filter(id => id !== rel_tree_datum.data.id);
                    rel_tree_datum.data.rels.parents = rel_tree_datum.data.rels.parents.filter(id => id !== datum.id);
                    onAccept();
                }
                function findRelType(d) {
                    if (d.is_ancestry) {
                        if (datum.rels.parents.includes(d.data.id))
                            return 'parent';
                    }
                    else if (d.spouse) {
                        if (!datum.rels.spouses)
                            throw new Error('Spouses not found');
                        if (datum.rels.spouses.includes(d.data.id))
                            return 'spouse';
                    }
                    else {
                        if (!datum.rels.children)
                            throw new Error('Children not found');
                        if (datum.rels.children.includes(d.data.id))
                            return 'children';
                    }
                    return null;
                }
            }
            function onCancel() {
                if (!this.is_active)
                    return;
                this.is_active = false;
                this.store.state.one_level_rels = false;
                if (!this.datum)
                    throw new Error('Datum not found');
                this.cancelCallback(this.datum);
                this.datum = null;
                this.onChange = null;
                this.onCancel = null;
            }
        }
    }

    function modal (cont) { return new Modal(cont); }
    class Modal {
        constructor(cont) {
            this.cont = cont;
            this.active = false;
            this.onClose = null;
            this.modal_cont = d3__namespace.select(this.cont).append('div').attr('class', 'f3-modal').node();
            d3__namespace.select(this.modal_cont).style('display', 'none');
            this.create();
        }
        create() {
            const modal = d3__namespace.select(this.modal_cont);
            modal.html(`
      <div class="f3-modal-content">
        <span class="f3-modal-close">&times;</span>
        <div class="f3-modal-content-inner"></div>
        <div class="f3-modal-content-bottom"></div>
      </div>
    `);
            modal.select('.f3-modal-close').on('click', () => {
                this.close();
            });
            modal.on('click', (event) => {
                if (event.target == modal.node()) {
                    this.close();
                }
            });
        }
        activate(content, { boolean, onAccept, onCancel } = {}) {
            this.reset();
            const modal_content_inner = d3__namespace.select(this.modal_cont).select('.f3-modal-content-inner').node();
            if (typeof content === 'string') {
                modal_content_inner.innerHTML = content;
            }
            else {
                modal_content_inner.appendChild(content);
            }
            if (boolean) {
                if (!onAccept)
                    throw new Error('onAccept is required');
                if (!onCancel)
                    throw new Error('onCancel is required');
                d3__namespace.select(this.modal_cont).select('.f3-modal-content-bottom').html(`
        <button class="f3-modal-accept f3-btn">Accept</button>
        <button class="f3-modal-cancel f3-btn">Cancel</button>
      `);
                d3__namespace.select(this.modal_cont).select('.f3-modal-accept').on('click', () => { onAccept(); this.reset(); this.close(); });
                d3__namespace.select(this.modal_cont).select('.f3-modal-cancel').on('click', () => { this.close(); });
                this.onClose = onCancel;
            }
            this.open();
        }
        reset() {
            this.onClose = null;
            d3__namespace.select(this.modal_cont).select('.f3-modal-content-inner').html('');
            d3__namespace.select(this.modal_cont).select('.f3-modal-content-bottom').html('');
        }
        open() {
            this.modal_cont.style.display = 'block';
            this.active = true;
        }
        close() {
            this.modal_cont.style.display = 'none';
            this.active = false;
            if (this.onClose)
                this.onClose();
        }
    }

    var editTree = (cont, store) => new EditTree(cont, store);
    /**
     * EditTree class - Provides comprehensive editing capabilities for family tree data.
     *
     * This class handles all editing operations for family tree data, including:
     * - Adding new family members and relationships
     * - Editing existing person information
     * - Removing family members and relationships
     * - Form management and validation
     * - History tracking and undo/redo functionality
     * - Modal dialogs and user interactions
     *
     * @example
     * ```typescript
     * import * as f3 from 'family-chart'
     * const f3Chart = f3.createChart('#FamilyChart', data)
     * const f3EditTree = f3Chart.editTree()  // returns an EditTree instance
     *   .setFields(["first name","last name","birthday"])
     *   .setOnChange(() => {
     *      const updated_data = f3EditTree.exportData()
     *      // do something with the updated data
     *   })
     * ```
     */
    class EditTree {
        constructor(cont, store) {
            this.cont = cont;
            this.store = store;
            this.fields = [
                { type: 'text', label: 'first name', id: 'first name' },
                { type: 'text', label: 'last name', id: 'last name' },
                { type: 'text', label: 'birthday', id: 'birthday' },
                { type: 'text', label: 'avatar', id: 'avatar' }
            ];
            this.is_fixed = true;
            this.no_edit = false;
            this.onChange = null;
            this.editFirst = false;
            this.postSubmit = null;
            this.onFormCreation = null;
            this.createFormEdit = null;
            this.createFormNew = null;
            this.formCont = this.getFormContDefault();
            this.modal = this.setupModal();
            this.addRelativeInstance = this.setupAddRelative();
            this.removeRelativeInstance = this.setupRemoveRelative();
            this.history = this.createHistory();
            return this;
        }
        /**
         * Open the edit form
         * @param datum - The datum to edit
         */
        open(datum) {
            if (!datum.rels)
                datum = datum.data; // if TreeDatum is used, it will be converted to Datum. will be removed in a future version.
            if (this.addRelativeInstance.is_active)
                handleAddRelative(this);
            else if (this.removeRelativeInstance.is_active)
                handleRemoveRelative(this, this.store.getTreeDatum(datum.id));
            else {
                this.cardEditForm(datum);
            }
            function handleAddRelative(self) {
                if (datum._new_rel_data) {
                    self.cardEditForm(datum);
                }
                else {
                    self.addRelativeInstance.onCancel();
                    self.cardEditForm(datum);
                    self.store.updateMainId(datum.id);
                    self.store.updateTree({});
                }
            }
            function handleRemoveRelative(self, tree_datum) {
                if (!tree_datum)
                    throw new Error('Tree datum not found');
                if (!self.removeRelativeInstance.datum)
                    throw new Error('Remove relative datum not found');
                if (!self.removeRelativeInstance.onCancel)
                    throw new Error('Remove relative onCancel not found');
                if (!self.removeRelativeInstance.onChange)
                    throw new Error('Remove relative onChange not found');
                if (datum.id === self.removeRelativeInstance.datum.id) {
                    self.removeRelativeInstance.onCancel();
                    self.cardEditForm(datum);
                }
                else {
                    self.removeRelativeInstance.onChange(tree_datum, onAccept.bind(self));
                    function onAccept() {
                        self.removeRelativeInstance.onCancel();
                        self.updateHistory();
                        self.store.updateTree({});
                    }
                }
            }
        }
        setupAddRelative() {
            return addRelative(this.store, () => onActivate(this), (datum) => cancelCallback(this, datum));
            function onActivate(self) {
                if (self.removeRelativeInstance.is_active)
                    self.removeRelativeInstance.onCancel();
            }
            function cancelCallback(self, datum) {
                self.store.updateMainId(datum.id);
                self.store.updateTree({});
                self.openFormWithId(datum.id);
            }
        }
        setupRemoveRelative() {
            return removeRelative(this.store, onActivate.bind(this), cancelCallback.bind(this), this.modal);
            function onActivate() {
                if (this.addRelativeInstance.is_active)
                    this.addRelativeInstance.onCancel();
                setClass(this.cont, true);
            }
            function cancelCallback(datum) {
                setClass(this.cont, false);
                this.store.updateMainId(datum.id);
                this.store.updateTree({});
                this.openFormWithId(datum.id);
            }
            function setClass(cont, add) {
                d3__namespace.select(cont).select('#f3Canvas').classed('f3-remove-relative-active', add);
            }
        }
        createHistory() {
            const history = createHistory(this.store, this._getStoreDataCopy.bind(this), historyUpdateTree.bind(this));
            const nav_cont = this.cont.querySelector('.f3-nav-cont');
            if (!nav_cont)
                throw new Error("Nav cont not found");
            const controls = createHistoryControls(nav_cont, history);
            history.changed();
            controls.updateButtons();
            return Object.assign(Object.assign({}, history), { controls });
            function historyUpdateTree() {
                var _a;
                console.log('historyUpdateTree');
                if (this.addRelativeInstance.is_active)
                    this.addRelativeInstance.onCancel();
                if (this.removeRelativeInstance.is_active)
                    this.removeRelativeInstance.onCancel();
                this.store.updateTree({ initial: false });
                this.history.controls.updateButtons();
                this.openFormWithId((_a = this.store.getMainDatum()) === null || _a === void 0 ? void 0 : _a.id);
                if (this.onChange)
                    this.onChange();
            }
        }
        /**
         * Open the edit form without canceling the add relative or remove relative view
         * @param datum - The datum to edit
         */
        openWithoutRelCancel(datum) {
            this.cardEditForm(datum);
        }
        getFormContDefault() {
            let form_cont = d3__namespace.select(this.cont).select('div.f3-form-cont').node();
            if (!form_cont)
                form_cont = d3__namespace.select(this.cont).append('div').classed('f3-form-cont', true).node();
            return {
                el: form_cont,
                populate(form_element) {
                    form_cont.innerHTML = '';
                    form_cont.appendChild(form_element);
                },
                open() {
                    d3__namespace.select(form_cont).classed('opened', true);
                },
                close() {
                    d3__namespace.select(form_cont).classed('opened', false).html('');
                },
            };
        }
        setFormCont(formCont) {
            this.formCont = formCont;
            return this;
        }
        cardEditForm(datum) {
            const props = {};
            const is_new_rel = datum === null || datum === void 0 ? void 0 : datum._new_rel_data;
            if (is_new_rel) {
                props.onCancel = () => this.addRelativeInstance.onCancel();
            }
            else {
                props.addRelative = this.addRelativeInstance;
                props.removeRelative = this.removeRelativeInstance;
                props.deletePerson = () => {
                    deletePerson(datum, this.store.getData());
                    this.openFormWithId(this.store.getLastAvailableMainDatum().id);
                    this.store.updateTree({});
                };
            }
            const form_creator = formCreatorSetup(Object.assign({ store: this.store, datum, postSubmitHandler: (props) => postSubmitHandler(this, props), fields: this.fields, onCancel: () => { }, editFirst: this.editFirst, no_edit: this.no_edit, link_existing_rel_config: this.link_existing_rel_config, onFormCreation: this.onFormCreation, onSubmit: this.onSubmit, onDelete: this.onDelete, canEdit: this.canEdit, canDelete: this.canDelete }, props));
            const form_cont = is_new_rel
                ? (this.createFormNew || createFormNew)(form_creator, this.closeForm.bind(this))
                : (this.createFormEdit || createFormEdit)(form_creator, this.closeForm.bind(this));
            this.formCont.populate(form_cont);
            this.openForm();
            function postSubmitHandler(self, props) {
                if (self.addRelativeInstance.is_active) {
                    self.addRelativeInstance.onChange(datum, props);
                    if (self.postSubmit)
                        self.postSubmit(datum, self.store.getData());
                    const active_datum = self.addRelativeInstance.datum;
                    if (!active_datum)
                        throw new Error('Active datum not found');
                    self.store.updateMainId(active_datum.id);
                    self.openWithoutRelCancel(active_datum);
                }
                else if ((datum.to_add || datum.unknown) && (props === null || props === void 0 ? void 0 : props.link_rel_id)) {
                    handleLinkRel(datum, props.link_rel_id, self.store.getData());
                    self.store.updateMainId(props.link_rel_id);
                    self.openFormWithId(props.link_rel_id);
                }
                else if (!(props === null || props === void 0 ? void 0 : props.delete)) {
                    if (self.postSubmit)
                        self.postSubmit(datum, self.store.getData());
                    self.openFormWithId(datum.id);
                }
                if (!self.is_fixed)
                    self.closeForm();
                self.store.updateTree({});
                self.updateHistory();
            }
        }
        openForm() {
            this.formCont.open();
        }
        closeForm() {
            this.formCont.close();
            this.store.updateTree({});
        }
        fixed() {
            this.is_fixed = true;
            if (this.formCont.el)
                d3__namespace.select(this.formCont.el).style('position', 'relative');
            return this;
        }
        absolute() {
            this.is_fixed = false;
            if (this.formCont.el)
                d3__namespace.select(this.formCont.el).style('position', 'absolute');
            return this;
        }
        setCardClickOpen(card) {
            card.setOnCardClick((e, d) => {
                if (this.isAddingRelative()) {
                    this.open(d.data);
                }
                else if (this.isRemovingRelative()) {
                    this.open(d.data);
                }
                else {
                    this.open(d.data);
                    card.onCardClickDefault(e, d);
                }
            });
            return this;
        }
        openFormWithId(d_id) {
            if (d_id) {
                const d = this.store.getDatum(d_id);
                if (!d)
                    throw new Error('Datum not found');
                this.openWithoutRelCancel(d);
            }
            else {
                const d = this.store.getMainDatum();
                if (!d)
                    throw new Error('Main datum not found');
                this.openWithoutRelCancel(d);
            }
        }
        setNoEdit() {
            this.no_edit = true;
            return this;
        }
        setEdit() {
            this.no_edit = false;
            return this;
        }
        setFields(fields) {
            const new_fields = [];
            if (!Array.isArray(fields)) {
                console.error('fields must be an array');
                return this;
            }
            for (const field of fields) {
                if (typeof field === 'string') {
                    new_fields.push({ type: 'text', label: field, id: field });
                }
                else if (typeof field === 'object') {
                    if (!field.id) {
                        console.error('fields must be an array of objects with id property');
                    }
                    else {
                        new_fields.push(field);
                    }
                }
                else {
                    console.error('fields must be an array of strings or objects');
                }
            }
            this.fields = new_fields;
            return this;
        }
        /**
         * Set the onChange function to be called when the data changes via editing, adding, or removing a relative
         * @param fn - The onChange function
         */
        setOnChange(fn) {
            this.onChange = fn;
            return this;
        }
        setCanEdit(canEdit) {
            this.canEdit = canEdit;
            return this;
        }
        setCanDelete(canDelete) {
            this.canDelete = canDelete;
            return this;
        }
        setCanAdd(canAdd) {
            this.addRelativeInstance.setCanAdd(canAdd);
            return this;
        }
        addRelative(datum) {
            if (!datum)
                datum = this.store.getMainDatum();
            this.addRelativeInstance.activate(datum);
            return this;
        }
        setupModal() {
            return modal(this.cont);
        }
        setEditFirst(editFirst) {
            this.editFirst = editFirst;
            return this;
        }
        isAddingRelative() {
            return this.addRelativeInstance.is_active;
        }
        isRemovingRelative() {
            return this.removeRelativeInstance.is_active;
        }
        setAddRelLabels(add_rel_labels) {
            this.addRelativeInstance.setAddRelLabels(add_rel_labels);
            return this;
        }
        setLinkExistingRelConfig(link_existing_rel_config) {
            this.link_existing_rel_config = link_existing_rel_config;
            return this;
        }
        setOnFormCreation(onFormCreation) {
            this.onFormCreation = onFormCreation;
            return this;
        }
        setCreateFormEdit(createFormEdit) {
            this.createFormEdit = createFormEdit;
            return this;
        }
        setCreateFormNew(createFormNew) {
            this.createFormNew = createFormNew;
            return this;
        }
        _getStoreDataCopy() {
            let data = JSON.parse(JSON.stringify(this.store.getData())); // important to make a deep copy of the data
            if (this.addRelativeInstance.is_active)
                data = this.addRelativeInstance.cleanUp(data);
            data = cleanupDataJson(data);
            return data;
        }
        /**
         * deprecated: use exportData instead. This function will be removed in a future version.
         * Export the data
         * @returns family chart data
         */
        getStoreDataCopy() {
            return this.exportData();
        }
        /**
         * @returns family chart data
         */
        exportData() {
            let data = this._getStoreDataCopy();
            data = formatDataForExport(data, this.store.state.legacy_format);
            return data;
        }
        getDataJson() {
            return JSON.stringify(this.exportData(), null, 2);
        }
        updateHistory() {
            if (this.history) {
                this.history.changed();
                this.history.controls.updateButtons();
            }
            if (this.onChange)
                this.onChange();
        }
        setPostSubmit(postSubmit) {
            this.postSubmit = postSubmit;
            return this;
        }
        setOnSubmit(onSubmit) {
            this.onSubmit = onSubmit;
            return this;
        }
        setOnDelete(onDelete) {
            this.onDelete = onDelete;
            return this;
        }
        destroy() {
            this.history.controls.destroy();
            this.history = null;
            if (this.formCont.el)
                d3__namespace.select(this.formCont.el).remove();
            if (this.addRelativeInstance.onCancel)
                this.addRelativeInstance.onCancel();
            this.store.updateTree({});
            return this;
        }
    }

    function linkSpouseText(svg, tree, props) {
        const links_data = [];
        tree.data.forEach(d => {
            if (d.coparent && d.data.data.gender === 'F')
                links_data.push({ nodes: [d, d.coparent], id: `${d.data.id}--${d.coparent.data.id}` });
            if (d.spouses)
                d.spouses.forEach(sp => links_data.push({ nodes: [sp, d], id: `${sp.data.id}--${d.data.id}` }));
        });
        const link = d3__namespace.select(svg)
            .select(".links_view")
            .selectAll("g.link-text")
            .data(links_data, (d) => d.id);
        const link_exit = link.exit();
        const link_enter = link.enter().append("g").attr("class", "link-text");
        const link_update = link_enter.merge(link);
        const spouseLineX = (sp1, sp2) => {
            if (sp1.spouse && sp1.data.data.gender === 'F')
                return sp1.x - props.node_separation / 2;
            else if (sp2.spouse && sp2.data.data.gender === 'M')
                return sp2.x + props.node_separation / 2;
            else
                return Math.min(sp1.x, sp2.x) + props.node_separation / 2;
        };
        link_exit.each(linkExit);
        link_enter.each(linkEnter);
        link_update.each(linkUpdate);
        function linkEnter(d) {
            const [sp1, sp2] = d.nodes;
            const text_g = d3__namespace.select(this);
            text_g
                .attr('transform', `translate(${spouseLineX(sp1, sp2)}, ${sp1.y - 3})`)
                .style('opacity', 0);
            text_g.append("text").style('font-size', '12px').style('fill', '#fff').style('text-anchor', 'middle');
        }
        function linkUpdate(d) {
            const [sp1, sp2] = d.nodes;
            const text_g = d3__namespace.select(this);
            const delay = props.initial ? calculateDelay(tree, sp1, props.transition_time) : 0;
            text_g.select('text').text(props.linkSpouseText(sp1, sp2));
            text_g.transition('text').duration(props.transition_time).delay(delay)
                .attr('transform', `translate(${spouseLineX(sp1, sp2)}, ${sp1.y - 3})`);
            text_g.transition('text-op').duration(100).delay(delay + props.transition_time).style('opacity', 1);
        }
        function linkExit(d) {
            const text_g = d3__namespace.select(this);
            text_g.transition('text').duration(100).style('opacity', 0)
                .on("end", () => text_g.remove());
        }
    }

    function autocomplete (cont, onSelect, config = {}) { return new Autocomplete(cont, onSelect, config); }
    class Autocomplete {
        constructor(cont, onSelect, config = {}) {
            this.cont = cont;
            this.options = [];
            this.onSelect = onSelect;
            this.config = config;
            this.autocomplete_cont = d3__namespace.select(this.cont).append('div').attr('class', 'f3-autocomplete-cont').node();
            this.create();
        }
        create() {
            var _a;
            const self = this;
            d3__namespace.select(this.autocomplete_cont).html(`
      <div class="f3-autocomplete">
        <div class="f3-autocomplete-input-cont">
          <input type="text" placeholder="${((_a = this.config) === null || _a === void 0 ? void 0 : _a.placeholder) || 'Search'}">
          <span class="f3-autocomplete-toggle">${chevronDownSvgIcon()}</span>
        </div>
        <div class="f3-autocomplete-items" tabindex="0"></div>
      </div>
    `);
            const search_cont = d3__namespace.select(this.autocomplete_cont).select(".f3-autocomplete");
            const search_input = search_cont.select("input");
            const dropdown = search_cont.select(".f3-autocomplete-items");
            search_cont.on("focusout", () => {
                setTimeout(() => {
                    const search_cont_node = search_cont.node();
                    if (!search_cont_node.contains(document.activeElement)) {
                        closeDropdown();
                    }
                }, 200);
            });
            search_input
                .on("focus", () => {
                updateOptions();
                activateDropdown();
            })
                .on("input", activateDropdown)
                .on("keydown", handleArrowKeys);
            dropdown.on("wheel", e => e.stopPropagation());
            search_cont.select(".f3-autocomplete-toggle")
                .on("click", (e) => {
                e.stopPropagation();
                const is_active = search_cont.classed("active");
                search_cont.classed("active", !is_active);
                if (is_active) {
                    closeDropdown();
                }
                else {
                    const search_input_node = search_input.node();
                    search_input_node.focus();
                    activateDropdown();
                }
            });
            function activateDropdown() {
                search_cont.classed("active", true);
                const search_input_value = search_input.property("value");
                const filtered_options = self.options.filter(d => d.label.toLowerCase().includes(search_input_value.toLowerCase()));
                filtered_options.forEach(setHtmlLabel);
                filtered_options.sort(sortByLabel);
                updateDropdown(filtered_options);
                function setHtmlLabel(d) {
                    const index = d.label.toLowerCase().indexOf(search_input_value.toLowerCase());
                    if (index !== -1)
                        d.label_html = itemLabel();
                    else
                        d.label_html = d.label;
                    function itemLabel() {
                        return d.label.substring(0, index)
                            + '<strong>' + d.label.substring(index, index + search_input_value.length)
                            + '</strong>' + d.label.substring(index + search_input_value.length);
                    }
                }
                function sortByLabel(a, b) {
                    if (a.label < b.label)
                        return -1;
                    else if (a.label > b.label)
                        return 1;
                    else
                        return 0;
                }
            }
            function closeDropdown() {
                search_cont.classed("active", false);
                updateDropdown([]);
            }
            function updateDropdown(filtered_options) {
                dropdown.selectAll("div.f3-autocomplete-item")
                    .data(filtered_options, d => d === null || d === void 0 ? void 0 : d.value).join("div")
                    .attr("class", "f3-autocomplete-item")
                    .on("click", (e, d) => {
                    self.onSelect(d.value);
                })
                    .html(d => d.optionHtml ? d.optionHtml(d) : itemHtml(d));
                function itemHtml(d) {
                    return `<div class="${d.class ? d.class : ''}">${d.label_html}</div>`;
                }
            }
            function updateOptions() {
                self.options = self.getOptions();
            }
            function handleArrowKeys(e) {
                const items = dropdown.selectAll("div.f3-autocomplete-item").nodes();
                const currentIndex = items.findIndex(item => d3__namespace.select(item).classed("f3-selected"));
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                    selectItem(items, nextIndex);
                }
                else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                    selectItem(items, prevIndex);
                }
                else if (e.key === "Enter" && currentIndex !== -1) {
                    e.preventDefault();
                    const d = d3__namespace.select(items[currentIndex]).datum();
                    if (d) {
                        self.onSelect(d.value);
                    }
                }
                function selectItem(items, index) {
                    items.forEach(item => d3__namespace.select(item).classed("f3-selected", false));
                    if (items[index]) {
                        d3__namespace.select(items[index]).classed("f3-selected", true);
                        items[index].scrollIntoView({ block: "nearest" });
                    }
                }
            }
        }
        setOptionsGetter(getOptions) {
            this.getOptions = getOptions;
            return this;
        }
        setOptionsGetterPerson(getData, getLabel) {
            this.getOptions = () => {
                const options = [];
                const data = getData();
                data.forEach(d => {
                    if (d.to_add || d.unknown || d._new_rel_data)
                        return;
                    if (options.find(d0 => d0.value === d.id))
                        return;
                    options.push({
                        label: getLabel(d),
                        value: d.id,
                        optionHtml: optionHtml(d)
                    });
                });
                return options;
            };
            return this;
            function optionHtml(d) {
                const link_off = !checkIfConnectedToFirstPerson(d, getData());
                return (option) => (`
        <div>
          <span style="float: left; width: 10px; height: 10px; margin-right: 10px;" class="f3-${getPersonGender(d)}-color">${personSvgIcon()}</span>
          <span>${option.label_html}</span>
          ${link_off ? `<span style="float: right; width: 10px; height: 10px; margin-left: 5px;" title="This profile is not connected to the main profile">${linkOffSvgIcon()}</span>` : ''}
        </div>
      `);
            }
            function getPersonGender(d) {
                if (d.data.gender === "M")
                    return "male";
                else if (d.data.gender === "F")
                    return "female";
                else
                    return "genderless";
            }
        }
        destroy() {
            this.autocomplete_cont.remove();
        }
    }

    function processCardDisplay(card_display) {
        const card_display_arr = [];
        if (Array.isArray(card_display)) {
            card_display.forEach(d => {
                if (typeof d === 'function') {
                    card_display_arr.push(d);
                }
                else if (typeof d === 'string') {
                    card_display_arr.push((d1) => d1.data[d]);
                }
                else if (Array.isArray(d)) {
                    card_display_arr.push((d1) => d.map(key => d1.data[key]).join(' '));
                }
            });
        }
        else if (typeof card_display === 'function') {
            card_display_arr.push(card_display);
        }
        else if (typeof card_display === 'string') {
            card_display_arr.push((d1) => d1.data[card_display]);
        }
        return card_display_arr;
    }

    function pathToMain(cards, links, datum, main_datum) {
        const is_ancestry = datum.is_ancestry;
        const links_data = links.data();
        let links_node_to_main = [];
        let cards_node_to_main = [];
        if (is_ancestry) {
            const links_to_main = [];
            let parent = datum;
            let itteration1 = 0;
            while (parent !== main_datum && itteration1 < 100) {
                itteration1++; // to prevent infinite loop
                const spouse_link = links_data.find(d => d.spouse === true && (d.source === parent || d.target === parent));
                if (spouse_link) {
                    const child_links = links_data.filter(d => Array.isArray(d.target) && d.target.includes(spouse_link.source) && d.target.includes(spouse_link.target));
                    const child_link = getChildLinkFromAncestrySide(child_links, main_datum);
                    if (!child_link)
                        break;
                    links_to_main.push(spouse_link);
                    links_to_main.push(child_link);
                    parent = child_link.source;
                }
                else {
                    // single parent
                    const child_links = links_data.filter(d => Array.isArray(d.target) && d.target.includes(parent));
                    const child_link = getChildLinkFromAncestrySide(child_links, main_datum);
                    if (!child_link)
                        break;
                    links_to_main.push(child_link);
                    parent = child_link.source;
                }
            }
            links.each(function (d) {
                if (links_to_main.includes(d)) {
                    links_node_to_main.push({ link: d, node: this });
                }
            });
            const cards_to_main = getCardsToMain(datum, links_to_main);
            cards.each(function (d) {
                if (cards_to_main.includes(d)) {
                    cards_node_to_main.push({ card: d, node: this });
                }
            });
        }
        else if (datum.spouse && datum.spouse.data === main_datum.data) {
            links.each(function (d) {
                if (d.target === datum)
                    links_node_to_main.push({ link: d, node: this });
            });
            const cards_to_main = [main_datum, datum];
            cards.each(function (d) {
                if (cards_to_main.includes(d)) {
                    cards_node_to_main.push({ card: d, node: this });
                }
            });
        }
        else if (datum.sibling) {
            links.each(function (d) {
                if (!Array.isArray(datum.parents))
                    throw new Error('datum.parents is not an array');
                if (d.source === datum)
                    links_node_to_main.push({ link: d, node: this });
                if (d.source === main_datum && Array.isArray(d.target) && d.target.length === 2)
                    links_node_to_main.push({ link: d, node: this });
                if (datum.parents.includes(d.source) && !Array.isArray(d.target) && datum.parents.includes(d.target))
                    links_node_to_main.push({ link: d, node: this });
            });
            const cards_to_main = [main_datum, datum, ...(datum.parents || [])];
            cards.each(function (d) {
                if (cards_to_main.includes(d)) {
                    cards_node_to_main.push({ card: d, node: this });
                }
            });
        }
        else {
            let links_to_main = [];
            let child = datum;
            let itteration1 = 0;
            while (child !== main_datum && itteration1 < 100) {
                itteration1++; // to prevent infinite loop
                const child_link = links_data.find(d => d.target === child && Array.isArray(d.source));
                if (child_link) {
                    const spouse_link = links_data.find(d => d.spouse === true && sameArray([d.source, d.target], child_link.source));
                    links_to_main.push(child_link);
                    links_to_main.push(spouse_link);
                    if (spouse_link)
                        child = spouse_link.source;
                    else
                        child = child_link.source[0];
                }
                else {
                    const spouse_link = links_data.find(d => d.target === child && !Array.isArray(d.source)); // spouse link
                    if (!spouse_link)
                        break;
                    links_to_main.push(spouse_link);
                    child = spouse_link.source;
                }
            }
            links.each(function (d) {
                if (links_to_main.includes(d)) {
                    links_node_to_main.push({ link: d, node: this });
                }
            });
            const cards_to_main = getCardsToMain(main_datum, links_to_main);
            cards.each(function (d) {
                if (cards_to_main.includes(d)) {
                    cards_node_to_main.push({ card: d, node: this });
                }
            });
        }
        return { cards_node_to_main, links_node_to_main };
        function sameArray(arr1, arr2) {
            return arr1.every(d1 => arr2.some(d2 => d1 === d2));
        }
        function getCardsToMain(first_parent, links_to_main) {
            const all_cards = links_to_main.filter(d => d).reduce((acc, d) => {
                if (Array.isArray(d.target))
                    acc.push(...d.target);
                else
                    acc.push(d.target);
                if (Array.isArray(d.source))
                    acc.push(...d.source);
                else
                    acc.push(d.source);
                return acc;
            }, []);
            const cards_to_main = [main_datum, datum];
            getChildren(first_parent);
            return cards_to_main;
            function getChildren(d) {
                if (d.data.rels.children) {
                    d.data.rels.children.forEach(child_id => {
                        const child = all_cards.find(d0 => d0.data.id === child_id);
                        if (child) {
                            cards_to_main.push(child);
                            getChildren(child);
                        }
                    });
                }
            }
        }
        function getChildLinkFromAncestrySide(child_links, main_datum) {
            if (child_links.length === 0)
                return null;
            else if (child_links.length === 1)
                return child_links[0];
            else {
                // siblings of main
                // should be last level where we go to the main and not its siblings
                return child_links.find(d => d.source === main_datum);
            }
        }
    }

    function CardHtmlWrapper(cont, store) { return new CardHtml$1(cont, store); }
    /**
     * CardHtml class - Handles HTML-based card rendering and customization for family tree nodes.
     *
     * @example
     * ```typescript
     * import * as f3 from 'family-chart'
     * const f3Chart = f3.createChart('#FamilyChart', data)
     * const f3Card = f3Chart.setCardHtml()  // returns a CardHtml instance
     *   .setCardDisplay([["first name","last name"],["birthday"]]);
     * ```
     */
    let CardHtml$1 = class CardHtml {
        constructor(cont, store) {
            this.cont = cont;
            this.svg = this.cont.querySelector('svg.main_svg');
            this.store = store;
            this.card_display = [(d) => `${d.data["first name"]} ${d.data["last name"]}`];
            this.cardImageField = 'avatar';
            this.onCardClick = this.onCardClickDefault;
            this.style = 'default';
            this.mini_tree = false;
            this.card_dim = {};
            return this;
        }
        getCard() {
            return CardHtml$2({
                store: this.store,
                card_display: this.card_display,
                cardImageField: this.cardImageField,
                defaultPersonIcon: this.defaultPersonIcon,
                onCardClick: this.onCardClick,
                style: this.style,
                mini_tree: this.mini_tree,
                onCardUpdate: this.onCardUpdate,
                card_dim: this.card_dim,
                empty_card_label: this.store.state.single_parent_empty_card_label || '',
                unknown_card_label: this.store.state.unknown_card_label || '',
                cardInnerHtmlCreator: this.cardInnerHtmlCreator,
                duplicate_branch_toggle: this.store.state.duplicate_branch_toggle,
                onCardMouseenter: this.onCardMouseenter ? this.onCardMouseenter.bind(this) : undefined,
                onCardMouseleave: this.onCardMouseleave ? this.onCardMouseleave.bind(this) : undefined
            });
        }
        setCardDisplay(card_display) {
            this.card_display = processCardDisplay(card_display);
            return this;
        }
        setCardImageField(cardImageField) {
            this.cardImageField = cardImageField;
            return this;
        }
        setDefaultPersonIcon(defaultPersonIcon) {
            this.defaultPersonIcon = defaultPersonIcon;
            return this;
        }
        setOnCardClick(onCardClick) {
            this.onCardClick = onCardClick;
            return this;
        }
        onCardClickDefault(e, d) {
            this.store.updateMainId(d.data.id);
            this.store.updateTree({});
        }
        setStyle(style) {
            this.style = style;
            return this;
        }
        setMiniTree(mini_tree) {
            this.mini_tree = mini_tree;
            return this;
        }
        setOnCardUpdate(onCardUpdate) {
            this.onCardUpdate = onCardUpdate;
            return this;
        }
        setCardDim(card_dim) {
            if (typeof card_dim !== 'object') {
                console.error('card_dim must be an object');
                return this;
            }
            for (let key in card_dim) {
                const val = card_dim[key];
                if (typeof val !== 'number' && typeof val !== 'boolean') {
                    console.error(`card_dim.${key} must be a number or boolean`);
                    return this;
                }
                if (key === 'width')
                    key = 'w';
                if (key === 'height')
                    key = 'h';
                if (key === 'img_width')
                    key = 'img_w';
                if (key === 'img_height')
                    key = 'img_h';
                if (key === 'img_x')
                    key = 'img_x';
                if (key === 'img_y')
                    key = 'img_y';
                this.card_dim[key] = val;
            }
            return this;
        }
        resetCardDim() {
            this.card_dim = {};
            return this;
        }
        setCardInnerHtmlCreator(cardInnerHtmlCreator) {
            this.cardInnerHtmlCreator = cardInnerHtmlCreator;
            return this;
        }
        setOnHoverPathToMain() {
            this.onCardMouseenter = this.onEnterPathToMain.bind(this);
            this.onCardMouseleave = this.onLeavePathToMain.bind(this);
            return this;
        }
        unsetOnHoverPathToMain() {
            this.onCardMouseenter = undefined;
            this.onCardMouseleave = undefined;
            return this;
        }
        onEnterPathToMain(e, datum) {
            this.to_transition = datum.data.id;
            const main_datum = this.store.getTreeMainDatum();
            const cards = d3__namespace.select(this.cont).select('div.cards_view').selectAll('.card_cont');
            const links = d3__namespace.select(this.cont).select('svg.main_svg .links_view').selectAll('.link');
            const { cards_node_to_main, links_node_to_main } = pathToMain(cards, links, datum, main_datum);
            cards_node_to_main.forEach(d => {
                const delay = Math.abs(datum.depth - d.card.depth) * 200;
                d3__namespace.select(d.node.querySelector('div.card-inner'))
                    .transition().duration(0).delay(delay)
                    .on('end', () => this.to_transition === datum.data.id && d3__namespace.select(d.node.querySelector('div.card-inner')).classed('f3-path-to-main', true));
            });
            links_node_to_main.forEach(d => {
                const delay = Math.abs(datum.depth - d.link.depth) * 200;
                d3__namespace.select(d.node)
                    .transition().duration(0).delay(delay)
                    .on('end', () => this.to_transition === datum.data.id && d3__namespace.select(d.node).classed('f3-path-to-main', true));
            });
            return this;
        }
        onLeavePathToMain(e, d) {
            this.to_transition = false;
            d3__namespace.select(this.cont).select('div.cards_view').selectAll('div.card-inner').classed('f3-path-to-main', false);
            d3__namespace.select(this.cont).select('svg.main_svg .links_view').selectAll('.link').classed('f3-path-to-main', false);
            return this;
        }
    };

    function CardSvgWrapper(cont, store) { return new CardSvg$1(cont, store); }
    let CardSvg$1 = class CardSvg {
        constructor(cont, store) {
            this.cont = cont;
            this.store = store;
            this.svg = this.cont.querySelector('svg.main_svg');
            this.card_dim = { w: 220, h: 70, text_x: 75, text_y: 15, img_w: 60, img_h: 60, img_x: 5, img_y: 5 };
            this.card_display = [];
            this.mini_tree = true;
            this.link_break = false;
            this.onCardClick = this.onCardClickDefault.bind(this);
            return this;
        }
        getCard() {
            return CardSvg$2({
                store: this.store,
                svg: this.svg,
                card_dim: this.card_dim,
                card_display: this.card_display,
                mini_tree: this.mini_tree,
                link_break: this.link_break,
                onCardClick: this.onCardClick,
                onCardUpdate: this.onCardUpdate
            });
        }
        setCardDisplay(card_display) {
            this.card_display = processCardDisplay(card_display);
            return this;
        }
        setCardDim(card_dim) {
            if (typeof card_dim !== 'object') {
                console.error('card_dim must be an object');
                return this;
            }
            for (let key in card_dim) {
                const val = card_dim[key];
                if (typeof val !== 'number' && typeof val !== 'boolean') {
                    console.error(`card_dim.${key} must be a number or boolean`);
                    return this;
                }
                if (key === 'width')
                    key = 'w';
                if (key === 'height')
                    key = 'h';
                if (key === 'img_width')
                    key = 'img_w';
                if (key === 'img_height')
                    key = 'img_h';
                if (key === 'img_x')
                    key = 'img_x';
                if (key === 'img_y')
                    key = 'img_y';
                this.card_dim[key] = val;
            }
            updateCardSvgDefs(this.svg, this.card_dim);
            return this;
        }
        setOnCardUpdate(onCardUpdate) {
            this.onCardUpdate = onCardUpdate;
            return this;
        }
        setMiniTree(mini_tree) {
            this.mini_tree = mini_tree;
            return this;
        }
        setLinkBreak(link_break) {
            this.link_break = link_break;
            return this;
        }
        onCardClickDefault(e, d) {
            this.store.updateMainId(d.data.id);
            this.store.updateTree({});
        }
        setOnCardClick(onCardClick) {
            this.onCardClick = onCardClick;
            return this;
        }
    };

    function createChart(cont, data) {
        return new Chart(cont, data);
    }
    /**
     * Main Chart class - The primary class for creating and managing family tree visualizations.
     *
     * This is the main entry point for the Family Chart library. Use this class to:
     * - Create and configure family tree visualizations
     * - Set up data, styling, and interaction options
     * - Control tree layout, orientation, and display settings
     * - Manage user interactions and updates
     *
     * @example
     * ```typescript
     * const f3Chart = createChart('#FamilyChart', data)  // returns a Chart instance;
     * ```
     */
    class Chart {
        constructor(cont, data) {
            this.getCard = null;
            this.transition_time = 2000;
            this.linkSpouseText = null;
            this.personSearch = null;
            this.is_card_html = false;
            this.beforeUpdate = null;
            this.afterUpdate = null;
            this.cont = setCont(cont);
            const { svg } = htmlContSetup(this.cont);
            this.svg = svg;
            createNavCont(this.cont);
            const main_id = data && data.length > 0 ? data[0].id : '';
            this.store = this.createStore(data, main_id);
            this.setOnUpdate();
            this.editTreeInstance = null;
            return this;
        }
        createStore(data, main_id) {
            return createStore({
                data,
                main_id,
                node_separation: 250,
                level_separation: 150,
                single_parent_empty_card: true,
                is_horizontal: false,
            });
        }
        setOnUpdate() {
            this.store.setOnUpdate((props) => {
                if (this.beforeUpdate)
                    this.beforeUpdate(props);
                props = Object.assign({ transition_time: this.store.state.transition_time }, props || {});
                if (this.is_card_html)
                    props = Object.assign({}, props || {}, { cardHtml: true });
                view(this.store.getTree(), this.svg, this.getCard(), props || {});
                if (this.linkSpouseText)
                    linkSpouseText(this.svg, this.store.getTree(), Object.assign({}, props || {}, { linkSpouseText: this.linkSpouseText, node_separation: this.store.state.node_separation }));
                if (this.afterUpdate)
                    this.afterUpdate(props);
            });
        }
        /**
         * Update the tree
         * @param props - The properties to update the tree with.
         * @param props.initial - Whether to update the tree initially.
         * @param props.tree_position - The position of the tree.
         * - 'fit' to fit the tree to the container,
         * - 'main_to_middle' to center the tree on the main person,
         * - 'inherit' to inherit the position from the previous update.
         * @param props.transition_time - The transition time.
         * @returns The CreateChart instance
         */
        updateTree(props = { initial: false }) {
            this.store.updateTree(props);
            return this;
        }
        /**
         * Update the data
         * @param data - The data to update the tree with.
         * @returns The CreateChart instance
         */
        updateData(data) {
            this.store.updateData(data);
            return this;
        }
        /**
         * Set the card y spacing
         * @param card_y_spacing - The card y spacing between the cards. Level separation.
         * @returns The CreateChart instance
         */
        setCardYSpacing(card_y_spacing) {
            if (typeof card_y_spacing !== 'number') {
                console.error('card_y_spacing must be a number');
                return this;
            }
            this.store.state.level_separation = card_y_spacing;
            return this;
        }
        /**
         * Set the card x spacing
         * @param card_x_spacing - The card x spacing between the cards. Node separation.
         * @returns The CreateChart instance
         */
        setCardXSpacing(card_x_spacing) {
            if (typeof card_x_spacing !== 'number') {
                console.error('card_x_spacing must be a number');
                return this;
            }
            this.store.state.node_separation = card_x_spacing;
            return this;
        }
        /**
         * Set the orientation to vertical
         * @returns The CreateChart instance
         */
        setOrientationVertical() {
            this.store.state.is_horizontal = false;
            return this;
        }
        /**
         * Set the orientation to horizontal
         * @returns The CreateChart instance
         */
        setOrientationHorizontal() {
            this.store.state.is_horizontal = true;
            return this;
        }
        /**
         * Set whether to show the siblings of the main person
         * @param show_siblings_of_main - Whether to show the siblings of the main person.
         * @returns The CreateChart instance
         */
        setShowSiblingsOfMain(show_siblings_of_main) {
            this.store.state.show_siblings_of_main = show_siblings_of_main;
            return this;
        }
        /**
         * set function that will modify the tree hierarchy. it can be used to delete or add cards in the tree.
         * @param modifyTreeHierarchy - function that will modify the tree hierarchy.
         * @returns The CreateChart instance
         */
        setModifyTreeHierarchy(modifyTreeHierarchy) {
            this.store.state.modifyTreeHierarchy = modifyTreeHierarchy;
            return this;
        }
        /**
         * Set the private cards config
         * @param private_cards_config - The private cards config.
         * @param private_cards_config.condition - The condition to check if the card is private.
         * - Example: (d: Datum) => d.data.living === true
         * @returns The CreateChart instance
         */
        setPrivateCardsConfig(private_cards_config) {
            this.store.state.private_cards_config = private_cards_config;
            return this;
        }
        /**
         * Option to set text on spouse links
         * @param linkSpouseText - The function to set the text on the spouse links.
         * - Example: (sp1, sp2) => getMarriageDate(sp1, sp2)
         * @returns The CreateChart instance
         */
        setLinkSpouseText(linkSpouseText) {
            this.linkSpouseText = linkSpouseText;
            return this;
        }
        /**
         * Set whether to show the single parent empty card
         * @param single_parent_empty_card - Whether to show the single parent empty card.
         * @param label - The label to display for the single parent empty card.
         * @returns The CreateChart instance
         */
        setSingleParentEmptyCard(single_parent_empty_card, { label = 'Unknown' } = {}) {
            this.store.state.single_parent_empty_card = single_parent_empty_card;
            this.store.state.single_parent_empty_card_label = label;
            if (this.editTreeInstance && this.editTreeInstance.addRelativeInstance.is_active)
                this.editTreeInstance.addRelativeInstance.onCancel();
            removeToAddFromData(this.store.getData() || []);
            return this;
        }
        /**
         * Set the Card creation function
         * @param Card - The card function.
         * @returns The CreateChart instance
         */
        setCard(card) {
            if (card === CardHtmlWrapper)
                return this.setCardHtml();
            else if (card === CardSvgWrapper)
                return this.setCardSvg();
            else
                throw new Error('Card must be an instance of cardHtml or cardSvg');
        }
        /**
         * Set the Card HTML function
         * @returns The CardHtml instance
         */
        setCardHtml() {
            const htmlSvg = this.cont.querySelector('#htmlSvg');
            if (!htmlSvg)
                throw new Error('htmlSvg not found');
            this.is_card_html = true;
            this.svg.querySelector('.cards_view').innerHTML = '';
            htmlSvg.style.display = 'block';
            const card = CardHtmlWrapper(this.cont, this.store);
            this.getCard = () => card.getCard();
            return card;
        }
        /**
         * Set the Card SVG function
         * @returns The CardSvg instance
         */
        setCardSvg() {
            const htmlSvg = this.cont.querySelector('#htmlSvg');
            if (!htmlSvg)
                throw new Error('htmlSvg not found');
            this.is_card_html = false;
            this.svg.querySelector('.cards_view').innerHTML = '';
            htmlSvg.style.display = 'none';
            const card = CardSvgWrapper(this.cont, this.store);
            this.getCard = () => card.getCard();
            return card;
        }
        /**
         * Set the transition time
         * @param transition_time - The transition time in milliseconds
         * @returns The CreateChart instance
         */
        setTransitionTime(transition_time) {
            this.store.state.transition_time = transition_time;
            return this;
        }
        /**
         * Set the sort children function
         * @param sortChildrenFunction - The sort children function.
         * - Example: (a, b) => a.data.birth_date - b.data.birth_date
         * @returns The CreateChart instance
         */
        setSortChildrenFunction(sortChildrenFunction) {
            this.store.state.sortChildrenFunction = sortChildrenFunction;
            return this;
        }
        /**
         * Set the sort spouses function
         * @param sortSpousesFunction - The sort spouses function.
         * - Example:
         *   (d, data) => {
         *     const spouses = d.data.rels.spouses || []
         *     return spouses.sort((a, b) => {
         *       const sp1 = data.find(d0 => d0.id === a)
         *       const sp2 = data.find(d0 => d0.id === b)
         *       if (!sp1 || !sp2) return 0
         *       return getMarriageDate(d, sp1) - getMarriageDate(d, sp2)
         *    })
         *   })
         * }
         * @returns The CreateChart instance
         */
        setSortSpousesFunction(sortSpousesFunction) {
            this.store.state.sortSpousesFunction = sortSpousesFunction;
            return this;
        }
        /**
         * Set how many generations to show in the ancestry
         * @param ancestry_depth - The number of generations to show in the ancestry.
         * @returns The CreateChart instance
         */
        setAncestryDepth(ancestry_depth) {
            this.store.state.ancestry_depth = ancestry_depth;
            return this;
        }
        /**
         * Set how many generations to show in the progeny
         * @param progeny_depth - The number of generations to show in the progeny.
         * @returns The CreateChart instance
         */
        setProgenyDepth(progeny_depth) {
            this.store.state.progeny_depth = progeny_depth;
            return this;
        }
        /**
         * Get the max depth of a person in the ancestry and progeny
         * @param d_id - The id of the person to get the max depth of.
         * @returns The max depth of the person in the ancestry and progeny. {ancestry: number, progeny: number}
         */
        getMaxDepth(d_id) {
            return getMaxDepth(d_id, this.store.getData());
        }
        /**
         * Calculate the kinships of a person
         * @param d_id - The id of the person to calculate the kinships of.
         * @param config - The config for the kinships.
         * @param config.show_in_law - Whether to show in law relations.
         * @returns The kinships of the person.
         */
        calculateKinships(d_id, config = {}) {
            return calculateKinships(d_id, this.store.getData(), config);
        }
        /**
         * Get the kinships data stash with which we can create small family tree with relatives that connects 2 people
         * @param main_id - The id of the main person.
         * @param rel_id - The id of the person to get the kinships of.
         * @returns The kinships data stash.
         */
        getKinshipsDataStash(main_id, rel_id) {
            return getKinshipsDataStash(main_id, rel_id, this.store.getData(), this.calculateKinships(main_id));
        }
        /**
         * Set whether to show toggable tree branches are duplicated
         * @param duplicate_branch_toggle - Whether to show toggable tree branches are duplicated.
         * @returns The CreateChart instance
         */
        setDuplicateBranchToggle(duplicate_branch_toggle) {
            this.store.state.duplicate_branch_toggle = duplicate_branch_toggle;
            return this;
        }
        /**
         * Initialize the edit tree
         * @returns The edit tree instance.
         */
        editTree() {
            return this.editTreeInstance = editTree(this.cont, this.store);
        }
        /**
         * Update the main person
         * @param d - New main person.
         * @returns The CreateChart instance
         */
        updateMain(d) {
            let d_id;
            if (d.id)
                d_id = d.id;
            else
                d_id = d.data.id;
            this.store.updateMainId(d_id);
            this.store.updateTree({});
            return this;
        }
        /**
         * Update the main person
         * @param id - New main person id.
         * @returns The CreateChart instance
         */
        updateMainId(id) {
            this.store.updateMainId(id);
            return this;
        }
        /**
         * Get the main person
         * @returns The main person.
         */
        getMainDatum() {
            return this.store.getMainDatum();
        }
        /**
         * Set the before update of the tree.
         * @param fn - The function to call before the update.
         * @returns The CreateChart instance
         */
        setBeforeUpdate(fn) {
            this.beforeUpdate = fn;
            return this;
        }
        /**
         * Set the after update of the tree.
         * @param fn - The function to call after the update.
         * @returns The CreateChart instance
         */
        setAfterUpdate(fn) {
            this.afterUpdate = fn;
            return this;
        }
        /**
         * Set the person dropdown
         * @param getLabel - The function to get the label of the person to show in the dropdown.
         * @param config - The config for the person dropdown.
         * @param config.cont - The container to put the dropdown in. Default is the .f3-nav-cont element.
         * @param config.onSelect - The function to call when a person is selected. Default is setting clicked person as main person and updating the tree.
         * @param config.placeholder - The placeholder for the search input. Default is 'Search'.
         * @returns The CreateChart instance
         */
        setPersonDropdown(getLabel, { cont = this.cont.querySelector('.f3-nav-cont'), onSelect, placeholder = 'Search' } = {}) {
            if (!onSelect)
                onSelect = onSelectDefault.bind(this);
            this.personSearch = autocomplete(cont, onSelect, { placeholder });
            this.personSearch.setOptionsGetterPerson(this.store.getData, getLabel);
            function onSelectDefault(d_id) {
                const datum = this.store.getDatum(d_id);
                if (!datum)
                    throw new Error('Datum not found');
                if (this.editTreeInstance)
                    this.editTreeInstance.open(datum);
                this.updateMainId(d_id);
                this.updateTree({ initial: false });
            }
            return this;
        }
        /**
         * Unset the person dropdown
         * @returns The CreateChart instance
         */
        unSetPersonSearch() {
            this.personSearch.destroy();
            this.personSearch = null;
            return this;
        }
    }
    function setCont(cont) {
        if (typeof cont === "string")
            cont = document.querySelector(cont);
        if (!cont)
            throw new Error('cont not found');
        return cont;
    }
    function createNavCont(cont) {
        d3__namespace.select(cont).append('div').attr('class', 'f3-nav-cont');
    }

    function kinshipInfo(kinship_info_config, rel_id, data_stash) {
        const { self_id, getLabel, title } = kinship_info_config;
        const relationships = calculateKinships(self_id, data_stash, kinship_info_config);
        const relationship = relationships[rel_id];
        if (!relationship)
            return;
        let label = relationship;
        if (relationship === 'self')
            label = 'You';
        else
            label = capitalizeLabel(label);
        const html = (`
    <div class="f3-kinship-info">
      <div class="f3-info-field">
        <span class="f3-info-field-label">${title}</span>
        <span class="f3-info-field-value">
          <span>${label}</span>
          <span class="f3-kinship-info-icon">${infoSvgIcon()}</span>
        </span>
      </div>
    </div>
  `);
        const kinship_info_node = d3__namespace.create('div').html(html).select('div').node();
        let popup = null;
        d3__namespace.select(kinship_info_node).select('.f3-kinship-info-icon').on('click', (e) => createPopup(e, kinship_info_node));
        return kinship_info_node;
        function createPopup(e, cont) {
            const width = 250;
            const height = 400;
            let left = e.clientX - width - 10;
            let top = e.clientY - height - 10;
            if (left + width > window.innerWidth) {
                left = window.innerWidth - width - 10;
            }
            if (top < 0) {
                top = 10;
            }
            if (popup && popup.active) {
                popup.close();
                popup = null;
                return;
            }
            popup = createInfoPopup(cont);
            d3__namespace.select(popup.popup_cont)
                .style('width', `${width}px`)
                .style('height', `${height}px`)
                .style('left', `${left}px`)
                .style('top', `${top}px`);
            const inner_cont = popup.popup_cont.querySelector('.f3-popup-content-inner');
            popup.activate();
            createSmallTree(self_id, rel_id, data_stash, relationships, inner_cont, getLabel);
        }
    }
    function createSmallTree(self_id, rel_id, data_stash, relationships, parent_cont, getLabel) {
        if (!d3__namespace.select(parent_cont).select('#SmallChart').node()) {
            d3__namespace.select(parent_cont).append('div').attr('id', 'SmallChart').attr('class', 'f3');
        }
        const small_chart = d3__namespace.select('#SmallChart');
        small_chart.selectAll('*').remove();
        const small_chart_data = getKinshipsDataStash(self_id, rel_id, data_stash, relationships);
        let kinship_label_toggle = true;
        const kinship_label_toggle_cont = small_chart.append('div');
        create(small_chart_data);
        function create(data) {
            const f3Chart = createChart('#SmallChart', data)
                .setTransitionTime(500)
                .setCardXSpacing(170)
                .setCardYSpacing(70)
                .setSingleParentEmptyCard(false);
            const f3Card = f3Chart.setCardHtml()
                .setStyle('rect')
                .setCardInnerHtmlCreator((d) => {
                return getCardInnerRect(d);
            })
                .setOnCardUpdate(function (d) {
                const card = d3__namespace.select(this).select('.card');
                card.classed('card-main', false);
            });
            f3Card.onCardClick = ((e, d) => { });
            f3Chart.updateTree({ initial: true });
            setTimeout(() => setupSameZoom(0.65), 100);
            createKinshipLabelToggle();
            function getCardInnerRect(d) {
                let label = d.data.kinship === 'self' ? 'You' : d.data.kinship;
                label = capitalizeLabel(label);
                if (!kinship_label_toggle)
                    label = getLabel(d.data);
                return (`
        <div class="card-inner card-rect ${getCardClass()}">
          <div class="card-label">${label}</div>
        </div>
      `);
                function getCardClass() {
                    if (d.data.kinship === 'self') {
                        return 'card-kinship-self' + (kinship_label_toggle ? '' : ' f3-real-label');
                    }
                    else if (d.data.id === rel_id) {
                        return 'card-kinship-rel';
                    }
                    else {
                        return 'card-kinship-default';
                    }
                }
            }
            function createKinshipLabelToggle() {
                kinship_label_toggle_cont
                    .classed('f3-kinship-labels-toggle', true);
                kinship_label_toggle_cont.append('label')
                    .text('Kinship labels')
                    .append('input')
                    .attr('type', 'checkbox')
                    .attr('checked', true)
                    .on('change', (e) => {
                    kinship_label_toggle = !kinship_label_toggle;
                    f3Chart.updateTree({ initial: false, tree_position: 'inherit' });
                });
            }
            function setupSameZoom(zoom_level) {
                const svg = f3Chart.cont.querySelector('svg.main_svg');
                const current_zoom = getCurrentZoom(svg);
                if (current_zoom.k > zoom_level) {
                    zoomTo(svg, zoom_level);
                }
            }
        }
    }
    function capitalizeLabel(label) {
        label = label[0].toUpperCase() + label.slice(1);
        if (label.includes('great-'))
            label = label.replace('great-', 'Great-');
        return label;
    }

    var elements = /*#__PURE__*/Object.freeze({
        __proto__: null,
        Card: Card,
        CardHtml: CardHtml$2,
        CardSvg: CardSvg$2,
        appendElement: appendElement,
        infoPopup: createInfoPopup,
        kinshipInfo: kinshipInfo
    });

    // export { default as calculateTree } from "./layout/calculate-tree"  // handled in deprecated section
    /** @deprecated Use cardSvg instead. This export will be removed in a future version. */
    const CardSvg = CardSvgWrapper;
    /** @deprecated Use cardHtml instead. This export will be removed in a future version. */
    const CardHtml = CardHtmlWrapper;
    const htmlHandlersWithDeprecated = Object.assign({}, htmlHandlers, { setupHtmlSvg, setupReactiveTreeData: _setupReactiveTreeData, getUniqueId });

    var exports$1 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        CalculateTree: CalculateTree,
        Card: Card,
        CardHtml: CardHtml,
        CardHtmlClass: CardHtml$1,
        CardSvg: CardSvg,
        CardSvgClass: CardSvg$1,
        calculateTree: calculateTreeWithV1Data,
        cardHtml: CardHtmlWrapper,
        cardSvg: CardSvgWrapper,
        createChart: createChart,
        createStore: createStore,
        createSvg: createSvg,
        elements: elements,
        formatData: formatData,
        formatDataForExport: formatDataForExport,
        handlers: handlers,
        htmlHandlers: htmlHandlersWithDeprecated,
        icons: icons,
        view: view
    });

    exports.CalculateTree = CalculateTree;
    exports.Card = Card;
    exports.CardHtml = CardHtml;
    exports.CardHtmlClass = CardHtml$1;
    exports.CardSvg = CardSvg;
    exports.CardSvgClass = CardSvg$1;
    exports.calculateTree = calculateTreeWithV1Data;
    exports.cardHtml = CardHtmlWrapper;
    exports.cardSvg = CardSvgWrapper;
    exports.createChart = createChart;
    exports.createStore = createStore;
    exports.createSvg = createSvg;
    exports.default = exports$1;
    exports.elements = elements;
    exports.formatData = formatData;
    exports.formatDataForExport = formatDataForExport;
    exports.handlers = handlers;
    exports.htmlHandlers = htmlHandlersWithDeprecated;
    exports.icons = icons;
    exports.view = view;

    Object.defineProperty(exports, '__esModule', { value: true });

}));
